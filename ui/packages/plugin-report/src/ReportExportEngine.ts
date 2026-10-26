/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReportComponentSchema, ReportExportConfig, ReportExportFormat, ReportField } from '@object-ui/types';

import { DISPLAY_LOCALE_LAST_RESORT } from './displayLocale';

/**
 * Report Export Engine
 * Handles exporting report data to various formats using browser-native APIs.
 *
 * ## The export's display locale (objectui#9909)
 *
 * The HTML and PDF exports stamp a "Generated:" time into a file the reader
 * downloads and keeps. That time used to be `new Date().toLocaleString()` —
 * no tag, i.e. the MACHINE's locale, which is neither of the repo's two
 * locale channels. The functions below take the tag as a trailing, OPTIONAL
 * `locale` parameter — the same additive shape `formatValue` took in
 * objectui#10020, and for the same reason: they are published exports, so a
 * required parameter would break every existing caller. Omitted, it falls back
 * to {@link DISPLAY_LOCALE_LAST_RESORT}, the display channel's own last resort
 * — never to a dropped tag. In React the caller passes `useDisplayLocale()`;
 * `ReportViewer` does. ⚠️ A display locale is a property of the SESSION, not
 * of the authored report, so it is deliberately NOT a `ReportExportConfig`
 * member: that type is authored metadata (`exportConfigs` on the schema).
 */

/**
 * Export report data as CSV
 */
export function exportAsCSV(report: ReportComponentSchema, data: any[], config?: ReportExportConfig): void {
  const fields = report.fields || [];
  const headers = fields.map((f: ReportField) => f.label || f.name);
  const rows = data.map((row: Record<string, any>) => fields.map((f: ReportField) => {
    let val = row[f.name];
    val = sanitizeCSVValue(val);
    // Escape CSV values
    if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val ?? '';
  }));

  const csvContent = [
    ...(config?.includeHeaders !== false ? [headers.join(',')] : []),
    ...rows.map(r => r.join(','))
  ].join('\n');

  downloadFile(csvContent, config?.filename || `${report.title || 'report'}.csv`, 'text/csv');
}

/**
 * Export report data as JSON
 */
export function exportAsJSON(report: ReportComponentSchema, data: any[], config?: ReportExportConfig): void {
  const exportData = {
    title: report.title,
    description: report.description,
    generatedAt: new Date().toISOString(),
    data,
  };
  const jsonContent = JSON.stringify(exportData, null, 2);
  downloadFile(jsonContent, config?.filename || `${report.title || 'report'}.json`, 'application/json');
}

/**
 * Export report as HTML (printable format)
 */
export function exportAsHTML(
  report: ReportComponentSchema,
  data: any[],
  config?: ReportExportConfig,
  locale: string = DISPLAY_LOCALE_LAST_RESORT,
): void {
  const fields = report.fields || [];
  const orientation = validateOrientation(config?.orientation);
  const pageSize = validatePageSize(config?.pageSize);
  
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHTML(report.title || 'Report')}</title>
<style>
  @page { size: ${pageSize} ${orientation}; margin: 20mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .description { color: #666; margin-bottom: 24px; }
  .meta { color: #999; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #f5f5f5; text-align: left; padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; }
  td { padding: 8px 12px; border: 1px solid #ddd; }
  tr:nth-child(even) { background: #fafafa; }
</style>
</head>
<body>
<h1>${escapeHTML(report.title || 'Report')}</h1>
${report.description ? `<p class="description">${escapeHTML(report.description)}</p>` : ''}
<p class="meta">Generated: ${new Date().toLocaleString(locale)}</p>
<table>
<thead><tr>${fields.map((f: ReportField) => `<th>${escapeHTML(f.label || f.name)}</th>`).join('')}</tr></thead>
<tbody>${data.map((row: Record<string, any>) => `<tr>${fields.map((f: ReportField) => `<td>${escapeHTML(String(row[f.name] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
</table>
</body>
</html>`;

  downloadFile(html, config?.filename || `${report.title || 'report'}.html`, 'text/html');
}

/**
 * Export report as PDF using browser print
 */
export function exportAsPDF(
  report: ReportComponentSchema,
  data: any[],
  config?: ReportExportConfig,
  locale: string = DISPLAY_LOCALE_LAST_RESORT,
): void {
  const fields = report.fields || [];
  const orientation = validateOrientation(config?.orientation);
  const pageSize = validatePageSize(config?.pageSize);
  
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    // Fallback to HTML download if popup blocked
    const fallbackConfig: ReportExportConfig = {
      ...config,
      format: 'html',
      filename: config?.filename?.replace(/\.pdf$/, '.html') || `${report.title || 'report'}.html`,
    };
    exportAsHTML(report, data, fallbackConfig, locale);
    return;
  }
  
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHTML(report.title || 'Report')}</title>
<style>
  @page { size: ${pageSize} ${orientation}; margin: 20mm; }
  @media print { .no-print { display: none; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .description { color: #666; margin-bottom: 24px; }
  .meta { color: #999; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #f5f5f5; text-align: left; padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; }
  td { padding: 8px 12px; border: 1px solid #ddd; }
  tr:nth-child(even) { background: #fafafa; }
</style>
</head>
<body>
<h1>${escapeHTML(report.title || 'Report')}</h1>
${report.description ? `<p class="description">${escapeHTML(report.description)}</p>` : ''}
<p class="meta">Generated: ${new Date().toLocaleString(locale)}</p>
<table>
<thead><tr>${fields.map((f: ReportField) => `<th>${escapeHTML(f.label || f.name)}</th>`).join('')}</tr></thead>
<tbody>${data.map((row: Record<string, any>) => `<tr>${fields.map((f: ReportField) => `<td>${escapeHTML(String(row[f.name] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
</table>
</body>
</html>`);

  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.print();
  };
}

/**
 * Export report as Excel-compatible CSV (with BOM for proper UTF-8 in Excel)
 */
export function exportAsExcel(report: ReportComponentSchema, data: any[], config?: ReportExportConfig): void {
  const fields = report.fields || [];
  const headers = fields.map((f: ReportField) => f.label || f.name);
  const rows = data.map((row: Record<string, any>) => fields.map((f: ReportField) => {
    let val = row[f.name];
    val = sanitizeCSVValue(val);
    if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\t'))) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val ?? '';
  }));

  // Tab-separated values with BOM for Excel compatibility
  const tsvContent = '\uFEFF' + [
    ...(config?.includeHeaders !== false ? [headers.join('\t')] : []),
    ...rows.map(r => r.join('\t'))
  ].join('\n');

  downloadFile(tsvContent, config?.filename || `${report.title || 'report'}.tsv`, 'text/tab-separated-values');
}

/**
 * Main export function - routes to correct format handler
 */
export function exportReport(
  format: ReportExportFormat, 
  report: ReportComponentSchema, 
  data: any[], 
  config?: ReportExportConfig,
  locale: string = DISPLAY_LOCALE_LAST_RESORT,
): void {
  switch (format) {
    case 'csv':
      exportAsCSV(report, data, config);
      break;
    case 'json':
      exportAsJSON(report, data, config);
      break;
    case 'html':
      exportAsHTML(report, data, config, locale);
      break;
    case 'pdf':
      exportAsPDF(report, data, config, locale);
      break;
    case 'excel':
      exportAsExcel(report, data, config);
      break;
    default:
      console.warn(`Unsupported export format: ${format}`);
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize CSV/Excel cell values to prevent formula injection.
 * Prefixes values starting with formula characters (=, +, -, @, |) with a tab.
 */
function sanitizeCSVValue(val: any): any {
  if (typeof val === 'string' && val.length > 0) {
    const firstChar = val.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@' || firstChar === '|') {
      return `\t${val}`;
    }
  }
  return val;
}

/**
 * Validate page size against allowed values
 */
function validatePageSize(pageSize: string | undefined): string {
  const allowed = ['A4', 'A3', 'Letter', 'Legal'];
  return allowed.includes(pageSize || '') ? pageSize! : 'A4';
}

/**
 * Validate orientation against allowed values
 */
function validateOrientation(orientation: string | undefined): string {
  return orientation === 'landscape' ? 'landscape' : 'portrait';
}

/**
 * Helper to trigger file download
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
