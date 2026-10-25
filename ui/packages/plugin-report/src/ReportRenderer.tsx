/**
 * ReportRenderer
 *
 * Thin dispatcher that routes a report schema to the correct renderer.
 *
 * ADR-0021 single-form: a 9.0 report is **dataset-bound** — it binds a
 * semantic-layer `dataset` and selects its `values` (measure names) grouped
 * by `rows` (dimension names). That is the live rendering path.
 *
 * Dispatch table:
 * | schema shape                          | Renderer                                  |
 * |---------------------------------------|-------------------------------------------|
 * | dataset-bound (dataset / blocks)      | <DatasetReportRenderer>                   |
 * | pre-9.0 spec report (stored JSON)     | specReportToPresentation → <ReportViewer> |
 * | legacy presentation ({data, columns}) | <LegacyReportRenderer>                    |
 *
 * The pre-9.0 query-form renderers (SpecReportGrid / MatrixRenderer /
 * JoinedReportRenderer) were retired with the cutover — stored old-shape JSON
 * renders through the lossy {@link specReportToPresentation} bridge until it
 * is migrated to a dataset binding.
 */

import * as React from 'react';
import {
  isSpecReport,
  specReportToPresentation,
  type SpecReport,
  type DataSource,
  type ReportViewerSchema,
} from '@object-ui/types';
import { SchemaRendererContext } from '@object-ui/react';
import { LegacyReportRenderer, type LegacyReportRendererProps } from './LegacyReportRenderer';
import { ReportViewer } from './ReportViewer';
import { DatasetReportRenderer, isDatasetReport, type DatasetDrillArgs } from './DatasetReportRenderer';

export type ReportRendererSchema = SpecReport | LegacyReportRendererProps['schema'];

export interface ReportRendererProps {
  /** Either a spec `Report` (dataset-bound) or a legacy presentation schema. */
  schema: ReportRendererSchema;
  /** Required for dataset-bound reports unless the host pre-fetched rows. */
  dataSource?: DataSource | Record<string, unknown>;
  /** Pre-fetched rows — feeds the pre-9.0 / legacy presentation paths. */
  rows?: Array<Record<string, unknown>>;
  /** Runtime filter merged on top of the report's own scope filter. */
  runtimeFilter?: Record<string, unknown>;
  /**
   * Drill-down sink for dataset-bound reports (ADR-0021 D2) — rows/cells
   * become clickable when provided. The host resolves the dataset's object
   * and dimension→field mapping and navigates to the underlying records.
   */
  onDrill?: (args: DatasetDrillArgs) => void;
  /** Optional class for the outer container. */
  className?: string;
}

export const ReportRenderer: React.FC<ReportRendererProps> = (props) => {
  const {
    dataSource: propDataSource,
    rows,
    runtimeFilter,
    onDrill,
    className,
  } = props;
  // Fall back to the SchemaRenderer context when no dataSource prop is
  // supplied. This happens when ReportRenderer is dispatched through
  // <SchemaRenderer schema={{ type: 'report', report: { ... } }} /> (e.g. from
  // the dashboard drill-down drawer), which does not forward runtime
  // context as props. Without this fallback the report cannot fetch
  // data and renders empty.
  const context = React.useContext(SchemaRendererContext);
  const dataSource = (propDataSource ?? context?.dataSource) as
    | DataSource
    | Record<string, unknown>
    | undefined;
  let schema = props.schema;
  // Unwrap the node's wrapper: { type: 'report', report: {...real spec report...} }.
  // SchemaRenderer registry dispatches on the outer `type`; the actual spec
  // report (with its own `type: 'matrix' | 'joined' | ...`) lives under `report`.
  // `report` is the one spelling since objectui#11440 retired the `spec-report`
  // alias, which carried the same wrapper; `ReportNodeSchema` declares it.
  if (
    schema && typeof schema === 'object'
    && (schema as Record<string, unknown>).type === 'report'
    && (schema as Record<string, unknown>).report
    && typeof (schema as Record<string, unknown>).report === 'object'
  ) {
    schema = (schema as Record<string, unknown>).report as ReportRendererSchema;
  }

  // ADR-0021 single-form: the dataset-bound path is THE report renderer.
  if (isDatasetReport(schema)) {
    return (
      <DatasetReportRenderer
        report={schema as Parameters<typeof DatasetReportRenderer>[0]['report']}
        dataSource={dataSource}
        runtimeFilter={runtimeFilter}
        onDrill={onDrill}
        className={className}
      />
    );
  }

  // Stored pre-9.0 spec JSON (objectName/columns query form) — its inline
  // renderers were retired; bridge it to the presentation viewer. The
  // conversion is lossy by construction (see specReportToPresentation): the
  // proper fix is migrating the stored report to a dataset binding.
  if (isSpecReport(schema)) {
    const presentation = specReportToPresentation(schema);
    const viewerSchema = {
      type: 'report-viewer',
      report: presentation,
      data: rows ?? [],
      showToolbar: false,
    } as unknown as ReportViewerSchema;
    return (
      <div className={className} data-testid="report-presentation-bridge">
        <ReportViewer schema={viewerSchema} />
      </div>
    );
  }

  // Legacy presentation path — pre-spec `{ data, columns, chart }` schemas.
  return <LegacyReportRenderer schema={schema as LegacyReportRendererProps['schema']} />;
};
