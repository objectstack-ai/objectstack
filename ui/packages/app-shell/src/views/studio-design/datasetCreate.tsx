// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27518 — Studio's *New dataset*: how an author who has just
 * built a package's objects gets a report or a chart over them.
 *
 * A report and a dashboard widget are dataset-bound (ADR-0021), and Studio's
 * pickers offered only the datasets that already existed, the platform's own
 * included, with no way to make one. The entry here sits beside both pickers
 * (the New report dialog's `ReportCreateFields` and the widget inspector's
 * dataset combo) and creates a `dataset` the way every other Studio item is
 * created: a draft of the existing metadata type, saved in this package
 * through the draft door, published with the package. The picker then binds
 * the new dataset. No second report data source, and nothing is derived
 * behind the author's back (ADR-0084: no implicit datasets): the author names
 * the dataset, picks its object and the fields it groups and totals, and the
 * document written is the one Setup › Datasets edits afterwards.
 *
 * What the dialog writes ({@link buildDatasetSkeleton}): the spec's dataset
 * create seed for the structure (its label-less `count` measure included),
 * the author's name, label and object, one dimension per picked group-by
 * field and one `sum` measure per picked number field.
 *
 * Studio only: the pillar provides {@link StudioDatasetAuthoringContext}, and
 * a picker outside the Studio (Setup's editors) has no entry.
 *
 * Internal to app-shell: not exported from the package root.
 */

import * as React from 'react';
import { Plus } from 'lucide-react';
import { getMetadataCreateSeed } from '@objectstack/spec/kernel';
import type { Dataset } from '@objectstack/spec/ui';
import { Button } from '@object-ui/components';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { seedStructuralDefaults } from '../metadata-admin/createBody.js';
import { fieldTypeToDimensionType } from '../metadata-admin/inspectors/useDatasetFields.js';
import { ObjectPicker, useObjectCatalog } from '../metadata-admin/inspectors/ObjectPicker.js';
import { readsAnyObject } from '../metadata-admin/inspectors/dataset-picker-options.js';
import { useObjectFields, type ObjectFieldInfo } from '../metadata-admin/previews/useObjectFields.js';
import type { UseDatasetCatalogResult } from '../metadata-admin/previews/useDatasetCatalog.js';
import { CreateItemDialog } from './CreateItemDialog.js';
import { plainRefusal } from './metadataError.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';

/** What a dataset create needs from the Studio: where to save, and whom to tell. */
export interface StudioDatasetAuthoring {
  /** The package the new dataset's draft is saved in. */
  packageId: string;
  /** The pillar's draft-saved signal (the pending-changes count). */
  onDraftSaved?: (saved?: { type: string; name: string }) => void;
}

/**
 * Provided by the Interfaces pillar. Its presence is also what makes a dataset
 * picker read the draft-overlaid catalog: an item created in the Studio is a
 * draft until the package publishes.
 */
export const StudioDatasetAuthoringContext = React.createContext<StudioDatasetAuthoring | null>(null);

export function useStudioDatasetAuthoring(): StudioDatasetAuthoring | null {
  return React.useContext(StudioDatasetAuthoringContext);
}

/**
 * The field types the dialog offers to group by: the single-valued categorical
 * ones, where each value names one bar or slice of a chart. A text field holds
 * a value per record and a date needs a granularity, so both are left to the
 * dataset designer.
 */
const GROUP_BY_FIELD_TYPES: ReadonlySet<string> = new Set([
  'select',
  'radio',
  'boolean',
  'toggle',
  'lookup',
  'master_detail',
]);

/** The field types the dialog offers to total: summed. */
const TOTAL_FIELD_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

/**
 * The object's fields the dialog offers, split by what a pick writes. The
 * platform's own bookkeeping columns (`system` AND `hidden`) are left out, as
 * the Data rail leaves them out (`isStudioHiddenSystemField`).
 */
export function datasetCandidateFields(fields: ObjectFieldInfo[]): {
  groupBy: ObjectFieldInfo[];
  totals: ObjectFieldInfo[];
} {
  const shown = fields.filter((f) => !isStudioHiddenSystemField({ system: f.system, hidden: f.hidden }));
  return {
    groupBy: shown.filter((f) => GROUP_BY_FIELD_TYPES.has(f.type)),
    totals: shown.filter((f) => TOTAL_FIELD_TYPES.has(f.type)),
  };
}

/** The field's own label, when it declares one: the author's text. */
function authoredLabel(f: ObjectFieldInfo): { label?: string } {
  return f.label && f.label !== f.name ? { label: f.label } : {};
}

/**
 * The new dataset's draft body: the spec's create seed for its structure, the
 * author's identity and object, a dimension per group-by field (its type
 * inferred as the dataset designer infers it) and a `sum` measure per total
 * field. A measure name the seed already holds gets a `_sum` suffix, since
 * measure names are unique (`DatasetSchema`).
 */
export function buildDatasetSkeleton(
  name: string,
  label: string,
  object: string,
  groupBy: ObjectFieldInfo[],
  totals: ObjectFieldInfo[],
): Dataset {
  const seed = seedStructuralDefaults(getMetadataCreateSeed('dataset') as Record<string, unknown> | undefined);
  const seedMeasures = (Array.isArray(seed.measures) ? seed.measures : []) as Dataset['measures'];
  const taken = new Set(seedMeasures.map((m) => m.name));
  return {
    ...seed,
    name,
    label,
    object,
    dimensions: groupBy.map((f) => ({
      name: f.name,
      ...authoredLabel(f),
      field: f.name,
      type: fieldTypeToDimensionType(f.type) as NonNullable<Dataset['dimensions'][number]['type']>,
    })),
    measures: [
      ...seedMeasures,
      ...totals.map((f) => ({
        name: taken.has(f.name) ? `${f.name}_sum` : f.name,
        ...authoredLabel(f),
        aggregate: 'sum' as const,
        field: f.name,
      })),
    ],
  };
}

/** One checklist of the dialog: the fields a pick adds to the dataset. */
function FieldChecklist({
  title,
  hint,
  fields,
  picked,
  onToggle,
  testId,
}: {
  title: string;
  hint: string;
  fields: ObjectFieldInfo[];
  picked: ReadonlySet<string>;
  onToggle: (name: string, on: boolean) => void;
  testId: string;
}): React.ReactElement | null {
  if (fields.length === 0) return null;
  return (
    <fieldset className="space-y-1.5" data-testid={testId}>
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <div className="max-h-40 space-y-1 overflow-auto">
        {fields.map((f) => (
          <label key={f.name} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(f.name)}
              onChange={(e) => onToggle(f.name, e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>{f.label}</span>
            {f.label !== f.name && <span className="font-mono text-[11px] text-muted-foreground">{f.name}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A set with `name` added or removed. */
function toggled(set: ReadonlySet<string>, name: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(name);
  else next.delete(name);
  return next;
}

/**
 * The New dataset dialog: the shared create form (name and identifier), the
 * object the dataset reads and the fields it groups and totals. `onCreated`
 * receives the saved name once the draft has landed.
 */
export function NewDatasetDialog({
  open,
  onOpenChange,
  authoring,
  initialObject,
  knownObjects,
  locale,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authoring: StudioDatasetAuthoring;
  /** The object the dialog opens on, when the picker knows it. */
  initialObject?: string;
  /** The objects the server serves: a name outside them is refused here. */
  knownObjects: ReadonlySet<string>;
  locale: SupportedLocale;
  onCreated: (name: string) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const [object, setObject] = React.useState('');
  const [groupBy, setGroupBy] = React.useState<ReadonlySet<string>>(new Set());
  const [totals, setTotals] = React.useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Each opening starts over, on the object the picker knows.
  React.useEffect(() => {
    if (!open) return;
    setObject(initialObject ?? '');
    setGroupBy(new Set());
    setTotals(new Set());
    setError(null);
  }, [open, initialObject]);

  // The draft-overlaid object, so a draft-only object offers its fields.
  const objectFields = useObjectFields(object || undefined);
  const candidates = React.useMemo(() => datasetCandidateFields(objectFields.fields), [objectFields.fields]);

  const pickObject = (next: string) => {
    setObject(next);
    setGroupBy(new Set());
    setTotals(new Set());
    setError(null);
  };

  const create = async (label: string, name: string) => {
    if (!object || !knownObjects.has(object)) {
      setError(t('engine.studio.interfaces.newDataset.needsObject', locale));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A name a dataset already holds, in this package or any other, is
      // refused and nothing is written: the draft door is a PUT by name.
      const [published, drafts] = await Promise.all([
        client.list<Record<string, unknown>>('dataset'),
        client.listDrafts({ type: 'dataset' }),
      ]);
      if ([...(published ?? []), ...(drafts ?? [])].some((row) => row?.name === name)) {
        setError(tFormat('engine.studio.interfaces.newDataset.taken', locale, { name }));
        return;
      }
      const body = buildDatasetSkeleton(
        name,
        label,
        object,
        candidates.groupBy.filter((f) => groupBy.has(f.name)),
        candidates.totals.filter((f) => totals.has(f.name)),
      );
      // The first-write pin refuses a draft that lands between the check above and this save.
      await client.save('dataset', name, body, {
        mode: 'draft',
        packageId: authoring.packageId,
        ifNoneMatch: '*',
        surface: 'studio',
      });
      authoring.onDraftSaved?.({ type: 'dataset', name });
      onOpenChange(false);
      onCreated(name);
    } catch (e) {
      setError(plainRefusal(e).message);
    } finally {
      setBusy(false);
    }
  };

  const noFields = !objectFields.loading && candidates.groupBy.length === 0 && candidates.totals.length === 0;
  return (
    <CreateItemDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('engine.studio.interfaces.newDataset.title', locale)}
      description={t('engine.studio.interfaces.newDataset.description', locale)}
      labelFieldLabel={t('engine.studio.interfaces.newDataset.nameLabel', locale)}
      labelPlaceholder={t('engine.studio.interfaces.newDataset.namePlaceholder', locale)}
      idFieldLabel={t('engine.studio.interfaces.create.idLabel', locale)}
      idPlaceholder={t('engine.studio.interfaces.newDataset.idPlaceholder', locale)}
      submitLabel={t('engine.studio.createDraft', locale)}
      submittingLabel={t('engine.studio.creating', locale)}
      busy={busy}
      error={error}
      locale={locale}
      onSubmit={({ label, name }) => void create(label, name)}
      extra={
        <div className="space-y-3">
          <ObjectPicker
            label={t('engine.studio.interfaces.newDataset.object', locale)}
            value={object}
            onCommit={pickObject}
            locale={locale}
          />
          {object &&
            (objectFields.loading ? (
              <p className="text-xs text-muted-foreground">{t('engine.studio.loading', locale)}</p>
            ) : noFields ? (
              <p className="text-xs text-muted-foreground" data-testid="new-dataset-no-fields">
                {t('engine.studio.interfaces.newDataset.noFields', locale)}
              </p>
            ) : (
              <>
                <FieldChecklist
                  title={t('engine.studio.interfaces.newDataset.groupBy', locale)}
                  hint={t('engine.studio.interfaces.newDataset.groupByHint', locale)}
                  fields={candidates.groupBy}
                  picked={groupBy}
                  onToggle={(name, on) => setGroupBy((s) => toggled(s, name, on))}
                  testId="new-dataset-group-by"
                />
                <FieldChecklist
                  title={t('engine.studio.interfaces.newDataset.totals', locale)}
                  hint={t('engine.studio.interfaces.newDataset.totalsHint', locale)}
                  fields={candidates.totals}
                  picked={totals}
                  onToggle={(name, on) => setTotals((s) => toggled(s, name, on))}
                  testId="new-dataset-totals"
                />
              </>
            ))}
        </div>
      }
    />
  );
}

/**
 * The entry a dataset picker shows in the Studio: a line saying no dataset
 * reads this package's objects yet, while that is so (whatever else the
 * catalog holds), and the New dataset button with its dialog. The dialog opens
 * on the package's object when it has exactly one. A create reloads the
 * picker's catalog, then hands the new name to `onCreated` for the picker to
 * bind.
 */
export function DatasetCreateEntry({
  authoring,
  catalog,
  onCreated,
  locale,
  testId,
}: {
  authoring: StudioDatasetAuthoring;
  catalog: UseDatasetCatalogResult;
  onCreated: (name: string) => void;
  locale: SupportedLocale;
  testId: string;
}): React.ReactElement {
  const objects = useObjectCatalog();
  const [open, setOpen] = React.useState(false);
  const served = objects.status === 'loaded' ? objects.data : null;
  const knownObjects = React.useMemo(() => new Set((served ?? []).map((o) => o.name)), [served]);
  const packageObjects = React.useMemo(
    () => (served ?? []).filter((o) => o.packageId === authoring.packageId && !o.isSystem).map((o) => o.name),
    [served, authoring.packageId],
  );
  const unread =
    served !== null && !catalog.loading && !readsAnyObject(catalog.datasets, new Set(packageObjects));
  return (
    <div className="space-y-1.5">
      {unread && (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-hint`}>
          {t('engine.studio.interfaces.newDataset.noPackageDatasets', locale)}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
        data-testid={`${testId}-open`}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('engine.studio.interfaces.newDataset.open', locale)}
      </Button>
      <NewDatasetDialog
        open={open}
        onOpenChange={setOpen}
        authoring={authoring}
        initialObject={packageObjects.length === 1 ? packageObjects[0] : undefined}
        knownObjects={knownObjects}
        locale={locale}
        onCreated={(name) => {
          catalog.reload?.();
          onCreated(name);
        }}
      />
    </div>
  );
}
