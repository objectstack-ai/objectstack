/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Live Report Exporter
 *
 * Higher-level export engine that integrates with DataSource adapters
 * to fetch live data before exporting to PDF, Excel, or other formats.
 * Also provides Excel formula support and scheduled report generation triggers.
 *
 * @module plugin-report
 * @packageDocumentation
 */

import type {
  DataSource,
  QueryParams,
  ReportComponentSchema,
  ReportExportFormat,
  ReportExportConfig,
  ReportField,
  ReportScheduleConfig,
} from '@object-ui/types';
import { exportReport } from './ReportExportEngine';
import { DISPLAY_LOCALE_LAST_RESORT, formatNumberInDisplayLocale } from './displayLocale';

/**
 * Options for live report export
 */
export interface LiveExportOptions {
  /** Data source adapter (e.g. ApiDataSource or ObjectStackAdapter) */
  dataSource: DataSource;
  /** Resource / object name to query */
  resource: string;
  /** Additional query parameters */
  queryParams?: QueryParams;
  /** Export format override */
  format?: ReportExportFormat;
  /** Export config override */
  exportConfig?: ReportExportConfig;
  /**
   * BCP-47 display tag for the HTML / PDF "Generated:" time — in React,
   * whatever `useDisplayLocale()` (`@object-ui/i18n`) returned for the session.
   * Omitted, `exportReport` falls back to the display channel's own last
   * resort, never to the machine's locale (objectui#9909).
   */
  locale?: string;
}

/**
 * Excel column configuration for formatted export
 */
export interface ExcelColumnConfig {
  /** Field name */
  name: string;
  /** Column display header */
  header: string;
  /** Column width (character units) */
  width?: number;
  /** Number format (e.g. '#,##0.00', '0%') */
  numberFormat?: string;
  /** Excel formula template (use {ROW} as row placeholder) */
  formula?: string;
}

/**
 * Result of a live export operation
 */
export interface LiveExportResult {
  /** Whether the export succeeded */
  success: boolean;
  /** Number of records exported */
  recordCount: number;
  /** Export format used */
  format: ReportExportFormat;
  /** Error message if failed */
  error?: string;
}

/**
 * Schedule trigger callback
 */
export type ScheduleTriggerCallback = (
  report: ReportComponentSchema,
  schedule: ReportScheduleConfig,
) => void;

/**
 * Export a report with live data fetched from a DataSource adapter.
 *
 * @example
 * ```ts
 * await exportWithLiveData(report, {
 *   dataSource: myAdapter,
 *   resource: 'orders',
 *   format: 'pdf',
 * });
 * ```
 */
export async function exportWithLiveData(
  report: ReportComponentSchema,
  options: LiveExportOptions,
): Promise<LiveExportResult> {
  const {
    dataSource,
    resource,
    queryParams,
    format,
    exportConfig,
    locale,
  } = options;

  const exportFormat = format || report.defaultExportFormat || 'pdf';

  try {
    // Fetch live data from adapter
    const result = await dataSource.find(resource, queryParams);
    const data = result.data || [];

    // Merge export config from report schema and options
    const mergedConfig: ReportExportConfig = {
      format: exportFormat,
      ...report.exportConfigs?.[exportFormat],
      ...exportConfig,
    };

    // Route to export handler
    exportReport(exportFormat, report, data, mergedConfig, locale);

    return {
      success: true,
      recordCount: data.length,
      format: exportFormat,
    };
  } catch (error) {
    return {
      success: false,
      recordCount: 0,
      format: exportFormat,
      error: (error as Error).message,
    };
  }
}

/**
 * Export report as Excel with formatted columns and formula support.
 *
 * Generates a TSV file with:
 * - Column headers from field labels
 * - Formatted numeric values
 * - Excel formula cells (=SUM, =AVERAGE, etc.)
 * - UTF-8 BOM for proper character display
 *
 * @example
 * ```ts
 * exportExcelWithFormulas(report, data, {
 *   columns: [
 *     { name: 'amount', header: 'Amount', numberFormat: '#,##0.00' },
 *     { name: 'total', header: 'Total', formula: '=B{ROW}*C{ROW}' },
 *   ],
 *   includeAggregationRow: true,
 * });
 * ```
 */
export function exportExcelWithFormulas(
  report: ReportComponentSchema,
  data: any[],
  options: {
    columns?: ExcelColumnConfig[];
    filename?: string;
    includeAggregationRow?: boolean;
    /**
     * BCP-47 tag the numeric cells are formatted in — in React, whatever
     * `useDisplayLocale()` (`@object-ui/i18n`) returned for the session.
     *
     * It lives on the OPTIONS BAG because this module is not a component and
     * has no hook to read: a locale can only reach it from its caller, and a
     * report schema is the wrong carrier for it (a display locale is a property
     * of the session, not of the authored report). Omitted, it falls back to
     * the display channel's own last resort — never to `'en-US'`, and never to
     * a dropped tag, which would mean the MACHINE's locale (objectui#10020).
     */
    locale?: string;
  } = {},
): void {
  const { columns, filename, includeAggregationRow = false, locale = DISPLAY_LOCALE_LAST_RESORT } = options;

  // Determine columns from options or fall back to report fields
  const cols: ExcelColumnConfig[] = columns || (report.fields || []).map(fieldToExcelColumn);

  // Build header row
  const headers = cols.map(c => c.header);

  // Build data rows
  const rows: string[][] = data.map((row, rowIndex) => {
    return cols.map(col => {
      if (col.formula) {
        // Excel formula: replace {ROW} with actual row number (header is row 1)
        return col.formula.replace(/\{ROW\}/g, String(rowIndex + 2));
      }
      const value = row[col.name];
      return formatCellValue(value, col.numberFormat, locale);
    });
  });

  // Optional aggregation row
  if (includeAggregationRow && data.length > 0) {
    const aggRow = cols.map((col: ExcelColumnConfig, colIndex: number) => {
      const field = (report.fields || []).find(f => f.name === col.name);
      if (field?.aggregation) {
        const colLetter = getExcelColumnLetter(colIndex);
        const dataStart = 2; // Row 2 (after header)
        const dataEnd = data.length + 1;
        switch (field.aggregation) {
          case 'sum':
            return `=SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})`;
          case 'avg':
            return `=AVERAGE(${colLetter}${dataStart}:${colLetter}${dataEnd})`;
          case 'count':
            return `=COUNTA(${colLetter}${dataStart}:${colLetter}${dataEnd})`;
          case 'min':
            return `=MIN(${colLetter}${dataStart}:${colLetter}${dataEnd})`;
          case 'max':
            return `=MAX(${colLetter}${dataStart}:${colLetter}${dataEnd})`;
          default:
            return '';
        }
      }
      return '';
    });
    rows.push(aggRow);
  }

  // Build TSV content with BOM
  const tsvContent = '\uFEFF' + [
    headers.join('\t'),
    ...rows.map(r => r.join('\t')),
  ].join('\n');

  const outputFilename = filename || `${report.title || 'report'}.tsv`;
  downloadFile(tsvContent, outputFilename, 'text/tab-separated-values');
}

/**
 * Create a schedule trigger that can be invoked by workflow engines.
 *
 * Returns a callback that, when invoked, exports the report using the
 * schedule's configured formats and notifies the provided handler.
 *
 * @example
 * ```ts
 * const trigger = createScheduleTrigger(report, dataSource, 'orders', (report, schedule) => {
 *   // Send email with attachments
 *   sendEmail(schedule.recipients, schedule.subject, ...);
 * });
 *
 * // Invoke from workflow engine
 * await trigger();
 * ```
 */
export function createScheduleTrigger(
  report: ReportComponentSchema,
  dataSource: DataSource,
  resource: string,
  onComplete: ScheduleTriggerCallback,
): () => Promise<LiveExportResult[]> {
  return async () => {
    const schedule = report.schedule;
    if (!schedule?.enabled) {
      return [];
    }

    const formats = schedule.formats || [report.defaultExportFormat || 'pdf'];
    const results: LiveExportResult[] = [];

    for (const format of formats) {
      const result = await exportWithLiveData(report, {
        dataSource,
        resource,
        format,
      });
      results.push(result);
    }

    onComplete(report, schedule);
    return results;
  };
}

// ==========================================================================
// Helpers
// ==========================================================================

/**
 * Convert a ReportField to an ExcelColumnConfig
 */
function fieldToExcelColumn(field: ReportField): ExcelColumnConfig {
  return {
    name: field.name,
    header: field.label || field.name,
  };
}

/**
 * Format a cell value for Excel export
 */
function formatCellValue(
  value: any,
  numberFormat?: string,
  locale: string = DISPLAY_LOCALE_LAST_RESORT,
): string {
  if (value == null) return '';
  if (typeof value === 'number' && numberFormat) {
    // Basic formatting: apply locale-aware number formatting
    return formatNumberInDisplayLocale(value, locale, inferLocaleOptions(numberFormat));
  }
  return sanitizeExcelValue(String(value));
}

/**
 * Infer Intl.NumberFormat options from a simple format string
 */
function inferLocaleOptions(format: string): Intl.NumberFormatOptions {
  if (format.includes('%')) {
    return { style: 'percent', minimumFractionDigits: 0 };
  }
  const decimals = (format.match(/0/g) || []).length;
  return {
    minimumFractionDigits: Math.max(0, decimals - 1),
    maximumFractionDigits: Math.max(0, decimals - 1),
  };
}

/**
 * Convert column index (0-based) to Excel column letter (A, B, ..., Z, AA, AB, ...)
 */
function getExcelColumnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Sanitize cell values to prevent formula injection in Excel.
 * Prefixes values starting with formula characters (=, +, -, @, |) with a
 * single-quote, which is the standard Excel protection against formula injection.
 */
function sanitizeExcelValue(val: string): string {
  if (val.length > 0) {
    const firstChar = val.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@' || firstChar === '|') {
      return `'${val}`;
    }
  }
  return val;
}

/**
 * Trigger file download in browser
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
