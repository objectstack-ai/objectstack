// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportBuilderHost — the console's host for the report builder
 * (`@object-ui/plugin-report`'s `ReportBuilder`, objectstack#36374).
 *
 * One host for both doors into the builder: the report page's 「Edit」
 * (`ReportView`) and the new-report page (`ReportNewPage`). It holds the edit
 * buffer, reads the dataset catalog and the bound dataset's members through
 * the metadata client (the same hooks the Studio report inspector reads), and
 * owns the name and description boxes, whose text depends on the served
 * translation of the report (`servedLabel.ts`, objectstack#35008 / #36373 /
 * #36481). Writing the report is the caller's: `onSave` resolves `true` when
 * the report was saved, and the builder closes only then.
 *
 * It also draws the report filter under the data source (「+ Filter」,
 * objectstack#36645): the report's `runtimeFilter`, edited with the console's
 * one `FilterCondition` editor (`FilterConditionField`, the dataset
 * designer's) over the dataset object's fields (`useReportFilterFields`).
 *
 * @module
 */

import * as React from 'react';
import { ReportBuilder, type ReportDraft, type DatasetDrillArgs } from '@object-ui/plugin-report';
import type { DataSource } from '@object-ui/types';
import { useSafeTranslate } from '@object-ui/i18n';
import { useDatasetCatalog, useDatasetSemantics } from './metadata-admin/previews/useDatasetCatalog.js';
import { FilterConditionField } from './metadata-admin/inspectors/FilterConditionField.js';
import type { FilterCondition } from './metadata-admin/inspectors/datasetFilterCondition.js';
import { useReportFilterFields } from './reportFilterFields.js';
import { shownLabel, writtenLabel, servedLabelNote, useLabelLanguage } from './metadata-admin/inspectors/servedLabel.js';
import { tFormat, useMetadataLocale } from './metadata-admin/i18n.js';
import type { ServedReportText } from './studio-design/servedReportText.js';

export interface ReportBuilderHostProps {
  /** The report as the builder opens on it: the authored buffer, or a new report's seed. */
  initial: ReportDraft;
  /** The served text of the report's name and description; `null` for a new report. */
  servedText?: ServedReportText | null;
  /** Write the report. `true` when it was saved; the host then closes the builder. */
  onSave: (report: ReportDraft) => Promise<boolean>;
  /** Leave the builder without saving. `dirty`: the builder holds edits that leaving drops. */
  onClose: (left: { dirty: boolean }) => void;
  /** A notice above the preview (the pending-draft bar). */
  banner?: React.ReactNode;
  dataSource?: DataSource;
  onDrill?: (args: DatasetDrillArgs) => void;
}

function Note({ note, locale, testId }: { note: ReturnType<typeof servedLabelNote>; locale: string; testId: string }) {
  if (!note) return null;
  return (
    <p role="note" data-testid={testId} data-note-kind={note.kind} className="px-1 text-[11px] leading-snug text-muted-foreground">
      {tFormat(
        note.kind === 'kept' ? 'engine.inspector.servedLabel.kept' : 'engine.inspector.servedLabel.ifKept',
        locale,
        { served: note.served },
      )}
    </p>
  );
}

export function ReportBuilderHost({ initial, servedText, onSave, onClose, banner, dataSource, onDrill }: ReportBuilderHostProps) {
  const [draft, setDraft] = React.useState<ReportDraft>(initial);
  const [saving, setSaving] = React.useState(false);
  const locale = useMetadataLocale();
  const language = useLabelLanguage(locale);

  const catalog = useDatasetCatalog();
  const dataset = typeof draft.dataset === 'string' ? draft.dataset : '';
  const semantics = useDatasetSemantics(dataset || undefined, catalog);
  const members = React.useMemo(
    () => (dataset && !semantics.loading ? { measures: semantics.measures, dimensions: semantics.dimensions } : undefined),
    [dataset, semantics.loading, semantics.measures, semantics.dimensions],
  );

  const tt = useSafeTranslate();
  const object = catalog.datasets.find((d) => d.name === dataset)?.object;
  const filterFields = useReportFilterFields(object, dataSource);
  const runtimeFilter =
    draft.runtimeFilter && typeof draft.runtimeFilter === 'object' && !Array.isArray(draft.runtimeFilter)
      ? (draft.runtimeFilter as FilterCondition)
      : undefined;
  // The last row removed (or Clear all) commits `undefined`: the key goes, so
  // a report with no filter is stored without one rather than with `{}`.
  const commitFilter = (fc: FilterCondition | undefined) =>
    setDraft((d) => {
      const next: ReportDraft = { ...d };
      if (fc === undefined) delete next.runtimeFilter;
      else next.runtimeFilter = fc;
      return next;
    });

  const dirty = React.useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  return (
    <ReportBuilder
      report={draft}
      onChange={setDraft}
      name={{
        value: shownLabel(draft.label, servedText?.label, language),
        onChange: (v) => setDraft((d) => ({ ...d, label: writtenLabel(d.label, servedText?.label, language, v, '') })),
        note: <Note note={servedLabelNote(draft.label, servedText?.label, language)} locale={locale} testId="report-builder-name-note" />,
      }}
      description={{
        value: shownLabel(draft.description, servedText?.description, language),
        onChange: (v) =>
          setDraft((d) => {
            const next = { ...d, description: writtenLabel(d.description, servedText?.description, language, v, undefined) };
            if (next.description === undefined) delete next.description;
            return next;
          }),
        note: <Note note={servedLabelNote(draft.description, servedText?.description, language)} locale={locale} testId="report-builder-description-note" />,
      }}
      datasets={catalog.datasets}
      datasetsLoading={catalog.loading}
      members={members}
      membersLoading={!!dataset && semantics.loading}
      catalogError={catalog.error ?? semantics.error ?? undefined}
      filter={
        dataset ? (
          <FilterConditionField
            value={runtimeFilter}
            onCommit={commitFilter}
            fields={filterFields.fields}
            locale={locale}
            addLabel={tt('report.builder.source.addFilter', 'Filter')}
            advancedNote={tt('report.builder.source.filterAdvanced', 'This filter cannot be changed here. It is kept as saved.')}
            noFieldsNote={
              filterFields.loading
                ? tt('report.builder.source.filterLoading', 'Loading fields…')
                : tt('report.builder.source.filterNoFields', 'This data source has no fields to filter on.')
            }
            testId="report-builder-filter-field"
          />
        ) : undefined
      }
      onSave={handleSave}
      onDiscard={() => setDraft(initial)}
      onClose={() => onClose({ dirty })}
      dirty={dirty}
      saving={saving}
      banner={banner}
      dataSource={dataSource}
      onDrill={onDrill}
    />
  );
}
