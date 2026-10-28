/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The report page's export control — `ReportSchema.exportOptions`
 * (`{ formats?, includeHeaders?, fileNamePrefix? }`, ruling 6408567749 on
 * objectstack-ai/objectstack#25873, letter B).
 *
 * What is exported is the report table AS DRAWN: the table (or the matrix
 * cross-tab) hands the cells it renders, totals included, to the report through
 * {@link ReportTableSnapshotContext}, and the download writes exactly those.
 * Nothing re-queries and nothing re-aggregates — the server totals are the
 * ones on screen (the ADR-0021 governance red line), and the active
 * `runtimeFilter` and period are whatever the table's own query carried.
 *
 * Formats are `csv` / `xlsx`, on by default: absent means both, `formats: []`
 * means no control. Who may export is not a report key: the control is offered
 * only when the viewer's effective API operations on the dataset's BASE object
 * (the query answer's `object`) include `export` — the predicate the list
 * toolbar applies (`ObjectPermission.allowExport`). An absent operation set (no
 * provider, an unrestricted object, an older server) keeps it available, as it
 * does on the list.
 *
 * Both files are written in the browser. The list's XLSX goes through the
 * server record stream, which carries records, not aggregated report rows, so
 * a report cannot use it; ExcelJS is imported only when an XLSX is asked for,
 * so the report bundle does not carry it at load.
 */

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import { buildExportFileName } from '@object-ui/core';
import { pickLocalized, useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';

/** One drawn cell: its text as shown, and the number behind a measure cell. */
export interface ReportExportCell {
  text: string;
  /** Present on a measure cell whose value is a finite number (written as a number to XLSX). */
  value?: number;
  /** A dimension value read from the data, guarded against spreadsheet formula injection. */
  fromData?: boolean;
}

/** The report table as drawn: one header row, then body rows (totals last). */
export interface ReportTableSnapshot {
  /** The dataset's base object, from the query answer — what the export permission is read on. */
  object?: string;
  header: string[];
  rows: ReportExportCell[][];
}

/**
 * Where a drawn table reports its cells. `null` outside a report that offers
 * export (a joined block, an embedded drill-down report), so publishing is a
 * no-op there.
 */
export const ReportTableSnapshotContext = React.createContext<((snapshot: ReportTableSnapshot | null) => void) | null>(
  null,
);

/**
 * Rendered inside a drawn table: hands its snapshot up, and withdraws it when
 * the table stops drawing rows (loading, error, unmount). Keyed on the
 * snapshot's CONTENT, never on the object's identity (ui AGENTS #10), so a
 * re-render with the same cells publishes nothing new.
 */
export function PublishReportTableSnapshot({ snapshot }: { snapshot: ReportTableSnapshot }) {
  const publish = React.useContext(ReportTableSnapshotContext);
  const key = JSON.stringify(snapshot);
  React.useEffect(() => {
    if (!publish) return undefined;
    publish(JSON.parse(key) as ReportTableSnapshot);
    return () => publish(null);
  }, [publish, key]);
  return null;
}

export type ReportTableExportFormat = 'csv' | 'xlsx';

const REPORT_EXPORT_FORMATS: readonly ReportTableExportFormat[] = ['csv', 'xlsx'];

/** The `exportOptions` shape the renderer reads (validated by `ReportSchema`). */
export interface ReportExportOptionsLike {
  formats?: unknown;
  includeHeaders?: unknown;
  fileNamePrefix?: unknown;
}

/** The formats the control offers: absent → both; `[]` → none; order as declared. */
export function readReportExportFormats(options: unknown): ReportTableExportFormat[] {
  const formats = (options as ReportExportOptionsLike | undefined)?.formats;
  if (!Array.isArray(formats)) return [...REPORT_EXPORT_FORMATS];
  const out: ReportTableExportFormat[] = [];
  for (const f of formats) {
    if ((REPORT_EXPORT_FORMATS as readonly unknown[]).includes(f) && !out.includes(f as ReportTableExportFormat)) {
      out.push(f as ReportTableExportFormat);
    }
  }
  return out;
}

/**
 * A cell read from the data that opens with a formula character is prefixed
 * with a tab, the guard `ReportExportEngine` applies. A measure cell is text
 * this renderer formatted from a number, so a leading minus stays a minus.
 */
function guardFormula(cell: ReportExportCell): string {
  const t = cell.text;
  return cell.fromData && /^[=+\-@|]/.test(t) ? `\t${t}` : t;
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The CSV text of a snapshot (CRLF rows, RFC 4180 quoting). */
export function buildReportCsv(snapshot: ReportTableSnapshot, includeHeaders: boolean): string {
  const lines: string[] = [];
  if (includeHeaders) lines.push(snapshot.header.map(csvField).join(','));
  for (const row of snapshot.rows) lines.push(row.map((c) => csvField(guardFormula(c))).join(','));
  return lines.join('\r\n');
}

/** The XLSX bytes of a snapshot: one sheet, measure cells as numbers. */
export async function buildReportXlsx(
  snapshot: ReportTableSnapshot,
  includeHeaders: boolean,
  sheetName: string,
): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  // Excel refuses a sheet name over 31 characters or carrying any of : \ / ? * [ ]
  const ws = wb.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Report');
  if (includeHeaders) {
    const header = ws.addRow(snapshot.header);
    header.font = { bold: true };
  }
  for (const row of snapshot.rows) {
    ws.addRow(row.map((c) => (c.value !== undefined ? c.value : guardFormula(c))));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ReportExportControlProps {
  /** `ReportSchema.exportOptions`, as stored. */
  exportOptions?: unknown;
  /** The report's label (localizable) and name, for the file name. */
  label?: unknown;
  name?: string;
  /** The drawn table; no control until there is one to export. */
  snapshot: ReportTableSnapshot | null;
}

/** The report header's Export control. Draws nothing when there is nothing the viewer may export. */
export function ReportExportControl({ exportOptions, label, name, snapshot }: ReportExportControlProps) {
  const { t, language } = useObjectTranslation();
  const { getObjectApiOperations } = usePermissions();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const formats = readReportExportFormats(exportOptions);
  if (formats.length === 0 || !snapshot) return null;
  // The list toolbar's predicate, on the dataset's base object.
  const ops = snapshot.object ? getObjectApiOperations(snapshot.object) : undefined;
  if (ops && !ops.includes('export')) return null;

  const options = (exportOptions ?? {}) as ReportExportOptionsLike;
  const includeHeaders = options.includeHeaders !== false;
  const reportLabel = pickLocalized(label, language) || name || '';
  const prefix = typeof options.fileNamePrefix === 'string' ? options.fileNamePrefix : undefined;

  const run = async (format: ReportTableExportFormat) => {
    setBusy(true);
    setError(null);
    try {
      const fileName = buildExportFileName(format, { prefix, label: reportLabel, objectName: name });
      if (format === 'csv') {
        // The BOM makes Excel open a UTF-8 CSV as UTF-8 (non-Latin labels).
        downloadBlob(new Blob(['\uFEFF', buildReportCsv(snapshot, includeHeaders)], { type: 'text/csv;charset=utf-8' }), fileName);
      } else {
        const bytes = await buildReportXlsx(snapshot, includeHeaders, reportLabel || 'Report');
        downloadBlob(new Blob([bytes], { type: XLSX_MIME }), fileName);
      }
      setOpen(false);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const exportText = t('list.export', { defaultValue: 'Export' });
  return (
    <div className="flex justify-end" data-testid="report-export">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" aria-label={exportText}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{exportText}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 p-2">
          <div className="space-y-1">
            {formats.map((format) => (
              <Button
                key={format}
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start text-xs"
                disabled={busy}
                data-testid={`report-export-${format}`}
                onClick={() => void run(format)}
              >
                {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                {t('list.exportAs', { format: format.toUpperCase(), defaultValue: `Export as ${format.toUpperCase()}` })}
              </Button>
            ))}
            {error ? (
              <div className="px-2 py-1 text-xs text-destructive" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A measure cell: its drawn text, and the number when the value is a finite one. */
export function exportMeasureCell(text: string, raw: unknown): ReportExportCell {
  return typeof raw === 'number' && Number.isFinite(raw) ? { text, value: raw } : { text };
}

/** A dimension cell: a value read from the data. */
export function exportDimensionCell(text: string): ReportExportCell {
  return { text, fromData: true };
}
