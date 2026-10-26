/**
 * ReportRenderer dispatcher tests (ADR-0021 single-form).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReportRenderer } from '../ReportRenderer';
import type { SpecReport } from '@object-ui/types';

vi.mock('../LegacyReportRenderer', () => ({
  LegacyReportRenderer: (props: { schema: { title?: string } }) => (
    <div data-testid="legacy-renderer-stub">{props.schema.title}</div>
  ),
}));

vi.mock('../ReportViewer', () => ({
  ReportViewer: (props: { schema: { report?: { title?: string } } }) => (
    <div data-testid="report-viewer-stub">{props.schema.report?.title}</div>
  ),
}));

// A 9.0 dataset-bound report — the live path.
const datasetSpec = {
  name: 'sales_by_region',
  label: 'Sales by Region',
  type: 'summary',
  dataset: 'sales_metrics',
  rows: ['region'],
  values: ['total_amount'],
} as unknown as SpecReport;

// Stored pre-9.0 ("query-form") spec JSON — renders via the lossy
// presentation bridge until migrated to a dataset binding.
const legacySpec = {
  name: 'spec_report',
  label: 'Spec Report',
  objectName: 'opportunity',
  type: 'tabular',
  columns: [{ field: 'amount' }],
} as unknown as SpecReport;

describe('ReportRenderer dispatcher', () => {
  it('routes dataset-bound reports to DatasetReportRenderer', () => {
    render(<ReportRenderer schema={datasetSpec} />);
    expect(screen.getByTestId('dataset-report')).toBeInTheDocument();
  });

  it('routes a typeless dataset-bound report (9.0 single form) to the dataset renderer', () => {
    render(
      <ReportRenderer
        schema={{ name: 'ds_report', dataset: 'sales_metrics', values: ['amount'] } as unknown as SpecReport}
      />,
    );
    expect(screen.getByTestId('dataset-report')).toBeInTheDocument();
  });

  it('routes joined reports with dataset-bound blocks to the dataset renderer', () => {
    const joined = {
      name: 'joined_demo',
      label: 'Joined',
      type: 'joined',
      blocks: [
        { name: 'block_one', dataset: 'sales_metrics', values: ['total_amount'] },
        { name: 'block_two', dataset: 'task_metrics', values: ['est_hours'], rows: ['status'] },
      ],
    } as unknown as SpecReport;
    render(<ReportRenderer schema={joined} />);
    expect(screen.getByTestId('dataset-joined-report')).toBeInTheDocument();
    expect(screen.getAllByTestId('dataset-report-block')).toHaveLength(2);
  });

  it('unwraps the `report` node\'s wrapper before dispatching (the shape `spec-report` carried until objectui#11440)', () => {
    render(
      <ReportRenderer
        schema={{ type: 'report', report: datasetSpec } as unknown as SpecReport}
      />,
    );
    expect(screen.getByTestId('dataset-report')).toBeInTheDocument();
  });

  it('does not unwrap the retired `spec-report` spelling (objectui#11440) — one spelling, no alias fallback', () => {
    render(
      <ReportRenderer
        schema={{ type: 'spec-report', report: datasetSpec } as unknown as SpecReport}
      />,
    );
    expect(screen.queryByTestId('dataset-report')).not.toBeInTheDocument();
  });

  it('bridges stored pre-9.0 spec reports to the presentation viewer', () => {
    render(<ReportRenderer schema={legacySpec} rows={[]} />);
    expect(screen.getByTestId('report-presentation-bridge')).toBeInTheDocument();
    // specReportToPresentation maps label → title.
    expect(screen.getByTestId('report-viewer-stub')).toHaveTextContent('Spec Report');
  });

  it('falls back to LegacyReportRenderer for presentation schemas', () => {
    render(
      <ReportRenderer
        schema={{ type: 'report', title: 'My Old Report', data: [], columns: [] }}
      />,
    );
    expect(screen.getByTestId('legacy-renderer-stub')).toHaveTextContent('My Old Report');
    expect(screen.queryByTestId('dataset-report')).not.toBeInTheDocument();
  });

  it('typeless schemas without a dataset fall back to LegacyReportRenderer', () => {
    const noType = { ...(legacySpec as unknown as Record<string, unknown>) };
    delete noType.type;
    render(<ReportRenderer schema={noType as unknown as SpecReport} />);
    expect(screen.getByTestId('legacy-renderer-stub')).toBeInTheDocument();
  });
});
