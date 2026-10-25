// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ViewVariantInspector — the curated "home" panel for a View variant.
 *
 * Shown:
 *   • as the DEFAULT right panel (no selection) for the primary variant, and
 *   • as the scoped inspector when a variant tab is selected
 *     (`{ kind:'view', id:'<variant>' }`).
 *
 * SPEC-DRIVEN: the per-view-type config fields are NOT hardcoded. They are
 * rendered by feeding the spec's canonical authoring form (`viewForm`) and
 * the spec-derived View JSONSchema into the generic {@link SchemaForm}. The
 * form's type-conditional `visibleWhen` sections automatically surface the
 * right fields for grid / kanban / calendar / gallery / gantt / timeline /
 * chart — adding a new view type or prop to `@objectstack/spec` flows
 * through with zero code changes here.
 *
 * The inspector keeps a thin curated layer for two cross-cutting concerns
 * the spec form can't express well on its own:
 *   1. the VIEW TYPE picker (options sourced from the spec `type` enum), and
 *   2. the bound OBJECT (stored at `data.object`, drives field loading).
 *
 * Column add / reorder / select lives in the live column canvas above the
 * grid; per-column properties live in {@link ViewColumnInspector}. Those
 * fields are therefore pruned from the spec form to avoid double-editing.
 */

import * as React from 'react';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  flagUnknownValue,
} from './_shared.js';
import { InspectorComboField } from './InspectorComboField.js';
import { useObjectOptions } from './useDatasetFields.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { SchemaForm } from '../SchemaForm.js';
import { useObjectFields, type ObjectFieldInfo } from '../previews/useObjectFields.js';
import { failed, loaded, type LoadState } from '../loadState.js';
import type { ObjectFieldOption, WidgetContext } from '../widgets.js';

/**
 * Object picker for the view's binding — a searchable dropdown over the live
 * object catalog (custom value still allowed) instead of recalling the API
 * name. The catalog hook lives in a child component so the parent inspector's
 * hook order is unaffected.
 */
function ViewObjectPicker({
  label,
  value,
  onCommit,
  placeholder,
  searchPlaceholder,
  disabled,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /** The search box's words, in the caller's locale (objectui#10696). */
  searchPlaceholder: string;
  disabled?: boolean;
}) {
  const { options, loading } = useObjectOptions();
  return (
    <InspectorComboField
      label={label}
      value={value}
      onCommit={onCommit}
      options={options.map((o) => ({ value: o.name, label: o.label }))}
      loading={loading}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      mono
    />
  );
}
import { FieldsListEditor } from '../previews/FieldsListEditor.js';
import { ConditionalFormattingEditor } from '../ConditionalFormattingEditor.js';
import {
  getViewForm,
  getListVariantSchema,
  getFormVariantSchema,
} from '../view-schema.js';
import { isFormFamilyKey } from '../view-variant-model.js';
import { mergeServerFields } from '../mergeServerFields.js';
import { t, tFormat } from '../i18n.js';
import { useRequiredInGatedSectionIssues } from './requiredInGatedSection.js';

/**
 * Variant-body fields this inspector renders with its own controls, pruned
 * from the spec-form graft so they are not double-rendered. Mirrors the
 * `hiddenFields` passed to SchemaForm (`type`/`object`/`label`) plus the
 * canvas-owned `columns`.
 */
const VIEW_CURATED_FIELDS = new Set(['type', 'object', 'label', 'columns', 'conditionalFormatting']);

export interface ViewVariantInspectorProps extends MetadataDefaultInspectorProps {
  /**
   * Draft key the variant BODY is stored under — drives reads/writes and
   * column selection ids. 'list' | … for the spec shape, 'config' for the
   * effective ({viewKind,config}) shape.
   */
  variantKey: string;
  /**
   * Logical family ('list' | 'form' | …). Drives form-vs-list rendering.
   * Defaults to `variantKey` when the two coincide (spec shape).
   */
  familyKey?: string;
  /** When true, the close (×) button is hidden (home mode). */
  isHome: boolean;
  /** Clear the current selection (scoped mode only). */
  onClearSelection?: () => void;
  /**
   * Report how many BLOCKING author-time issues this inspector is showing. Two
   * kinds, one per view family:
   *
   *   - list: conditional-formatting rules whose CEL does not parse
   *     (objectui#4527);
   *   - form: an object-required field inside a section gated on a predicate
   *     the object's field rules cannot restate (objectui#6900) — see
   *     `requiredInGatedSection.ts`.
   *
   * Both hosts carry it: `ViewInspector` (scoped) forwards the host's callback,
   * and `ViewDefaultInspector` (home) spreads `MetadataDefaultInspectorProps`,
   * whose contract has declared the same member since objectui#4527 phase 2.
   */
  onBlockingIssuesChange?: (count: number) => void;
  /**
   * Pre-resolved field catalog for the bound object. When supplied, both
   * this inspector and its {@link FieldsListEditor} skip the network fetch
   * (`useObjectFields`) and use this list instead. Hosts that already hold
   * the object definition (e.g. the runtime ViewConfigPanel) pass it to keep
   * the inspector free of any network dependency.
   */
  objectFieldsOverride?: ObjectFieldInfo[];
}

/** English fallback labels for the spec `type` enum (used when the i18n
 * catalog has no entry for a view type the spec introduces later). */
const TYPE_LABELS: Record<string, string> = {
  grid: 'Table / List',
  kanban: 'Kanban',
  calendar: 'Calendar',
  gallery: 'Gallery',
  gantt: 'Gantt',
  timeline: 'Timeline',
  map: 'Map',
  chart: 'Chart',
};

/** Localized label for a view `type`, falling back to the English map (and
 * then the raw value) when the i18n catalog has no entry. */
function typeLabel(value: string, locale?: string): string {
  const key = `engine.inspector.view.type.${value}`;
  const translated = t(key, locale);
  return translated === key ? (TYPE_LABELS[value] ?? value) : translated;
}

/** Keys re-pinned from the live draft after every spec-form edit. */
const PRESERVED_KEYS = ['columns', 'data', 'name'] as const;

/**
 * Resolve the object a view is bound to. The canonical ViewItem carries the
 * binding at the TOP LEVEL (`draft.object`) — authoritative for every view
 * kind. A list `config` body additionally denormalizes it into its render
 * data source (`config.data.object`); a form `config` has no such block. We
 * therefore prefer the body's render binding (so the preview stays accurate)
 * but always fall back to the top-level FK, which is the one field guaranteed
 * present across list AND form views.
 */
function readObjectBinding(
  variant: Record<string, unknown>,
  draft: Record<string, unknown>,
): { value: string; path: 'data.object' | 'object' | 'top' } {
  const data = variant.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && typeof data.object === 'string' && data.object) {
    return { value: data.object, path: 'data.object' };
  }
  if (typeof variant.object === 'string' && variant.object) {
    return { value: variant.object, path: 'object' };
  }
  if (typeof draft.object === 'string' && draft.object) {
    return { value: draft.object, path: 'top' };
  }
  return { value: '', path: 'top' };
}

/** Build the View-type picker's options (`InspectorSelectField`) from the spec `type` enum. */
function useTypeOptions(locale?: string) {
  return React.useMemo(() => {
    const schema = getListVariantSchema();
    const rawEnum = schema?.properties?.type?.enum;
    const values: string[] =
      Array.isArray(rawEnum) && rawEnum.length
        ? rawEnum.filter((v: unknown): v is string => typeof v === 'string')
        : ['grid', 'kanban', 'calendar', 'gallery', 'gantt', 'timeline'];
    const opts = values.map((v) => ({ value: v, label: typeLabel(v, locale) }));
    // objectui#8488 — a `type` the spec enum does not carry used to be appended
    // here UNFLAGGED, so an off-spec view type read exactly like an offered
    // one. `InspectorSelectField` synthesises and flags it now; `typeLabel`
    // still gets its say through `unknownValueLabel` at the call site, since a
    // retired type can still have a human name in `TYPE_LABELS`.
    return opts;
  }, [locale]);
}

export function ViewVariantInspector({
  draft,
  variantKey,
  familyKey,
  isHome,
  onPatch,
  readOnly,
  onClearSelection,
  onSelectionChange,
  onBlockingIssuesChange,
  objectFieldsOverride,
  locale,
  serverSchema,
}: ViewVariantInspectorProps) {
  const variant = (draft[variantKey] as Record<string, unknown> | undefined) ?? {};

  const isFormFamily = isFormFamilyKey(familyKey ?? variantKey);
  const viewType =
    typeof variant.type === 'string' ? (variant.type as string) : 'grid';
  const typeOptions = useTypeOptions(locale);
  const binding = readObjectBinding(variant, draft);

  // Canonical label lives at the top level (`draft.label`); a list `config`
  // mirrors it, a form `config` does not. Prefer the top-level value.
  const labelValue =
    (typeof draft.label === 'string' && draft.label) ||
    (typeof variant.label === 'string' ? (variant.label as string) : '') ||
    '';

  const rawColumns: unknown[] = Array.isArray(variant.columns)
    ? (variant.columns as unknown[])
    : [];
  const allStrings =
    rawColumns.length > 0 && rawColumns.every((c) => typeof c === 'string');

  // Load the bound object's field catalog so field-reference config props
  // (groupByField, startDateField, xAxisField, visibleFields, …) render as
  // object-field pickers rather than free-text inputs.
  const {
    fields: objectFields,
    loading: objectFieldsLoading,
    error: objectFieldsError,
  } = useObjectFields(binding.value || undefined, objectFieldsOverride);
  // Locale-bound `t` for child components that take a bare `(key) => string`
  // (e.g. CelPredicateField / ConditionalFormattingEditor).
  const tLocal = React.useCallback((k: string) => t(k, locale), [locale]);
  const fieldNames = React.useMemo(() => objectFields.map((f) => f.name), [objectFields]);
  const cfRules = Array.isArray(variant.conditionalFormatting)
    ? (variant.conditionalFormatting as unknown[])
    : [];

  /* ─── Blocking CEL verdicts → the host's Save gate (objectui#4527) ─────
   *
   * The conditional-formatting editor below mounts one `CelPredicateField`
   * per rule and owns the per-rule map; this inspector only stamps that
   * editor's aggregate with the variant it describes, so a verdict that
   * lands after the author switched variants cannot gate the one now on
   * screen. Mismatch is read as 0 at aggregation time rather than repaired
   * by a reset effect. The formatting editor is rendered for list families
   * only, so this term is always 0 on a form variant; the form family's own
   * term follows below. */
  const [celErrors, setCelErrors] = React.useState<{ variant: string; count: number }>({
    variant: variantKey,
    count: 0,
  });
  const reportCel = React.useCallback(
    (count: number) => {
      setCelErrors((prev) => {
        if (prev.variant !== variantKey) return { variant: variantKey, count };
        if (prev.count === count) return prev;
        return { variant: variantKey, count };
      });
    },
    [variantKey],
  );
  const celBlocking =
    celErrors.variant === variantKey && !isFormFamily ? celErrors.count : 0;

  /* ─── Required field in a gated section → the same Save gate (objectui#6900)
   *
   * The form family's term, beside — never inside — the CEL term above. Ruling
   * 5749269225 (letter c) lands the author-time refusal here, in the channel
   * already licensed to gate Save; the live Zod pass stays advisory. Computed
   * from the form body's sections and the bound object's catalog, which
   * `useObjectFields` above already reads. */
  const gatedRequiredIssues = useRequiredInGatedSectionIssues(
    isFormFamily ? variant : undefined,
    objectFields,
  );
  const blockingIssues = celBlocking + (isFormFamily ? gatedRequiredIssues.length : 0);
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);
  /**
   * objectui#5228 — the inspector is the SECOND host of `WidgetContext`, and it
   * used to drop two thirds of what its loader knows.
   *
   * `useObjectFields` reports a triple (`fields` / `loading` / `error`), and
   * this memo forwarded only `fields`. So a field catalog that FAILED to load
   * arrived at the `field-ref` / `field-multi` pickers as `[]` — the same value
   * a bound object with no fields sends — and the picker said "No object bound"
   * about an object that is bound and whose catalog simply could not be
   * fetched. That is the objectui#5170 defect class, still open on this host
   * after the `ResourceEditPage` one was closed, and it is here because nothing
   * in the old `WidgetContext` type required a producer to carry the fault at
   * all: the array WAS the contract.
   *
   * It cannot be dropped any more — the catalog is a `LoadState`, so the three
   * arms have to be spelled out. `loading` and `error` come straight off the
   * hook; everything else is a load that completed, including "no object bound
   * yet", which the hook already reports as an empty, error-free result and the
   * pickers already render as their empty state. No `idle` arm is synthesized
   * here: introducing one would change what an unbound inspector renders, which
   * is a separate question from the fault this closes.
   */
  const widgetContext = React.useMemo<WidgetContext>(() => {
    let fieldCatalog: LoadState<ObjectFieldOption[]>;
    if (objectFieldsError) {
      fieldCatalog = failed(objectFieldsError);
    } else if (objectFieldsLoading) {
      fieldCatalog = { status: 'loading' };
    } else {
      fieldCatalog = loaded(
        objectFields.map((f) => ({ name: f.name, label: f.label, type: f.type })),
      );
    }
    // objectui#8167 — `none`, and the reason is recorded here rather than
    // inherited: this inspector edits a VIEW VARIANT body, and `view` is one of
    // the ruling's "any type without a row" types, whose verdict is `none`.
    //
    // It reads the same way from the surface itself. The one predicate-bearing
    // key a variant carries is `conditionalFormatting[].condition`, and that key
    // is authored by the curated `ConditionalFormattingEditor` mounted above —
    // which declares `scope="record"` at its own mount (objectui#8164). So the
    // generic form below has no surface of its own to make a claim about, and
    // `none` states exactly that instead of letting `flattened` answer by
    // default.
    return { conditionScope: 'none', objectFields: fieldCatalog };
  }, [objectFields, objectFieldsLoading, objectFieldsError]);

  // Graft server-only fields onto the bundled variant form so new server
  // fields are editable even when the bundled spec lags (skew root-cure). A
  // View is a nested document: the variant body lives under
  // `serverSchema.properties.{list|form}`, so we pass that sub-schema.
  const serverVariantSchema = (() => {
    const props = (serverSchema?.properties as Record<string, any> | undefined);
    return (isFormFamily ? props?.form : props?.list) as
      | Record<string, unknown>
      | undefined;
  })();
  const { schema, form } = React.useMemo(
    () =>
      mergeServerFields({
        bundledSchema: isFormFamily ? getFormVariantSchema() : getListVariantSchema(),
        bundledForm: isFormFamily ? undefined : getViewForm(),
        serverSchema: serverVariantSchema,
        excludeFields: VIEW_CURATED_FIELDS,
        sectionTitle: t('engine.inspector.moreFields', locale),
      }),
    [isFormFamily, serverVariantSchema, locale],
  );

  /** Shallow-write a curated patch onto the variant. */
  const writeVariant = (patch: Record<string, unknown>) => {
    onPatch({ [variantKey]: { ...variant, ...patch } });
  };

  /** Whole-variant write from the spec form; re-pin canvas-owned keys. */
  const writeForm = (next: Record<string, unknown>) => {
    const merged: Record<string, unknown> = { ...next };
    for (const k of PRESERVED_KEYS) {
      if (k in variant) merged[k] = variant[k];
      else delete merged[k];
    }
    onPatch({ [variantKey]: merged });
  };

  /** Write the bound object: top-level FK is canonical; mirror the list
   *  body's render binding so the preview keeps resolving live data. */
  const setObject = (v: string) => {
    const patch: Record<string, unknown> = { object: v };
    if (variant.data && typeof variant.data === 'object') {
      patch[variantKey] = {
        ...variant,
        data: { ...(variant.data as Record<string, unknown>), object: v },
      };
    } else if (binding.path === 'object') {
      patch[variantKey] = { ...variant, object: v };
    }
    onPatch(patch);
  };

  /** Write the display label: top-level is canonical; mirror it onto the
   *  body so the preview / runtime view switcher show the same text. */
  const setLabel = (v: string) => {
    onPatch({ label: v, [variantKey]: { ...variant, label: v } });
  };

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.view.kind', locale)}
      title={String(labelValue || draft.name || variantKey)}
      onClose={() => onClearSelection?.()}
      closeLabel={t('engine.inspector.view.close', locale)}
      hideClose={isHome}
    >
      <InspectorTextField
        label={t('engine.inspector.view.label', locale)}
        value={labelValue}
        onCommit={setLabel}
        placeholder={t('engine.inspector.view.labelPlaceholder', locale)}
        disabled={readOnly}
      />
      <InspectorSelectField
        label={t('engine.inspector.view.type', locale)}
        value={viewType}
        options={typeOptions}
        unknownValueLabel={(v) =>
          flagUnknownValue(typeLabel(v, locale), t('engine.form.notFound', locale), locale)
        }
        onCommit={(v) => writeVariant({ type: v })}
        disabled={readOnly}
      />
      <ViewObjectPicker
        label={t('engine.inspector.view.object', locale)}
        value={binding.value}
        onCommit={setObject}
        searchPlaceholder={t('engine.inspector.dataset.searchObjects', locale)}
        disabled={readOnly}
      />

      {isFormFamily && gatedRequiredIssues.length > 0 && (
        <div
          className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-[11px] leading-snug text-destructive"
          role="alert"
          data-testid="view-gated-required-issues"
        >
          <p className="font-medium">{t('engine.inspector.view.gatedRequired.title', locale)}</p>
          {gatedRequiredIssues.map((issue) => {
            const vars = {
              field: issue.field,
              fieldLabel: issue.fieldLabel,
              object: binding.value,
              section: issue.section,
              predicate: issue.predicate,
            };
            return (
              <div key={`${issue.sectionIndex}:${issue.field}`} className="space-y-1">
                <p>{tFormat('engine.inspector.view.gatedRequired.issue', locale, vars)}</p>
                <p>{t('engine.inspector.view.gatedRequired.remedies', locale)}</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>{tFormat('engine.inspector.view.gatedRequired.remedyMove', locale, vars)}</li>
                  <li>{tFormat('engine.inspector.view.gatedRequired.remedyDrop', locale, vars)}</li>
                  <li>{tFormat('engine.inspector.view.gatedRequired.remedyUnrequire', locale, vars)}</li>
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {!isFormFamily && (
        <div className="border-t pt-3">
          <FieldsListEditor
            variantKey={variantKey}
            schema={variant}
            columns={rawColumns}
            allStrings={allStrings}
            objectName={binding.value || undefined}
            objectFieldsOverride={objectFieldsOverride}
            selectedIndex={null}
            readOnly={readOnly}
            onPatch={onPatch}
            onSelectionChange={onSelectionChange}
          />
        </div>
      )}

      {!isFormFamily && (
        <div className="border-t pt-3">
          <ConditionalFormattingEditor
            rules={cfRules as any}
            objectName={binding.value || undefined}
            fieldNames={fieldNames}
            disabled={readOnly}
            t={tLocal}
            onChange={(rules) =>
              writeVariant({ conditionalFormatting: rules.length > 0 ? rules : undefined })
            }
            onBlockingIssuesChange={reportCel}
          />
        </div>
      )}

      <div className="border-t pt-3">
        {schema ? (
          <SchemaForm
            schema={schema}
            form={form}
            value={variant}
            hiddenFields={['type', 'object', 'label']}
            readOnly={readOnly}
            widgetContext={widgetContext}
            onChange={writeForm}
          />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t('engine.inspector.view.noSchema', locale)}
          </p>
        )}
      </div>
    </InspectorShell>
  );
}
