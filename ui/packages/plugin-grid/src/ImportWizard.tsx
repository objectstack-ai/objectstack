/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT. Phase 15 L1: CSV/Excel Import Wizard
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  cn, Button, Badge, Progress, Input, Checkbox, Label, EmptyValue,
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DIALOG_VIEWPORT_GUTTER,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@object-ui/components';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, XCircle, X, ArrowRight, ArrowLeft, Save, Trash2, ClipboardPaste, Download, Undo2 } from 'lucide-react';
import { useObjectTranslation, notifyDataChanged } from '@object-ui/react';
import { resolveAffordance, sanitizeFileNameBase } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import {
  BOOLEAN_VALUE_TYPES, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES, SINGLE_OPTION_TYPES,
} from '@objectstack/spec/data';
import {
  BOOLEAN_IMPORT_TOKENS, REFERENCE_IMPORT_TYPES, isIdentityEmail, isImportableDateCell, isImportableTimeCell,
  isRecordEmail,
} from './importCoercionContract';
import type {
  DataSource,
  ImportRequestOptions,
  ImportRecordsResult,
  ImportRowResult,
  ImportWriteMode,
  CreateImportJobResult,
  ImportJobProgressInfo,
  ImportJobResultsInfo,
  ImportJobStatus,
  ImportJobSummaryInfo,
  ImportJobUndoResult,
} from '@object-ui/types';
import {
  parseSpreadsheetFile, delimitedFileDelimiter, parseClipboardTable, inferColumnType, isTypeCompatible,
  suggestColumnMappings, ImportParseError,
  type InferredType, type ColumnSuggestion, type MappingConfidence,
} from './importParsers';
import {
  asSavedMapping, buildSourceRows, summarizeSavedMapping, savedMappingToDisplayIndexMap,
  type SavedMapping,
} from './savedMapping';

/** Default English fallback strings used when no I18nProvider is mounted
 *  (standalone / unit-test usage). Mirrors the keys under `grid.import.*`.
 *
 *  This is a SECOND source of English copy alongside `@object-ui/i18n`'s `en`
 *  pack, and the two had already drifted (objectui#2872): the pack carried 62
 *  keys, this map 133, `zh` 130, no two the same set. They are now pinned to
 *  each other by `ImportWizard.i18n-parity.test.ts` — add a key here and to
 *  `en.ts` together, or that test fails. */
export const IMPORT_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'grid.import.title': 'Import {{object}}',
  'grid.import.stepUpload': 'Upload',
  'grid.import.stepMapping': 'Mapping',
  'grid.import.stepPreview': 'Preview',
  'grid.import.uploadDescription': 'Upload a CSV or Excel file, or paste from a spreadsheet to get started.',
  'grid.import.mappingDescription': 'Map columns to object fields.',
  'grid.import.previewDescription': 'Review data before importing.',
  'grid.import.dragDrop': 'Drag & drop a CSV or Excel file here, or click to browse',
  'grid.import.browseFiles': 'Browse Files',
  'grid.import.downloadTemplate': 'Download template',
  'grid.import.downloadTemplateHint': 'Get an Excel file of the columns you can import (required fields marked *), with instructions for filling it in.',
  'grid.import.templateFileName': '{{object}}-import-template',
  'grid.import.templateDownloadFailed': 'Could not download the template. Please try again.',
  'grid.import.templateNotPermitted': 'You do not have permission to create records of this object, so its import template is not available.',
  'grid.import.parsing': 'Parsing…',
  'grid.import.pasteHint': 'or paste (Ctrl/⌘+V) rows copied from Excel or Google Sheets',
  'grid.import.legacyXls': "Legacy .xls files aren't supported — please re-save as .xlsx.",
  'grid.import.unsupportedFile': 'Unsupported file type. Use CSV, TSV, or Excel (.xlsx).',
  'grid.import.parseFailed': 'Could not read this file. Please check the format and try again.',
  'grid.import.fileNeedsHeader': 'File must contain a header row and at least one data row.',
  'grid.import.mappingTemplate': 'Mapping template:',
  'grid.import.chooseTemplate': 'Choose template…',
  'grid.import.noSavedTemplates': 'No saved templates',
  'grid.import.noneOption': '— None —',
  'grid.import.saveCurrent': 'Save current',
  'grid.import.templateName': 'Template name',
  'grid.import.save': 'Save',
  'grid.import.deleteTemplate': 'Delete template',
  'grid.import.savedMapping': 'Saved mapping:',
  'grid.import.chooseSavedMapping': 'Choose a saved mapping…',
  'grid.import.manualMapping': '— Map columns manually —',
  'grid.import.transform': 'Transform',
  'grid.import.savedMappingHint': "Mapping “{{name}}” applies rename + transforms + type coercion on the server. Column mapping is read-only.",
  'grid.import.savedMappingPreviewNote': "The preview shows your source columns; on import, mapping “{{name}}” applies rename, transforms and type coercion on the server.",
  'grid.import.csvColumn': 'Column',
  'grid.import.mapsTo': 'Maps To',
  'grid.import.typeMismatch': 'Looks like {{type}}',
  'grid.import.autoMatched': 'Auto-matched',
  'grid.import.autoMatchedSummary': 'Auto-matched {{count}} column(s) — review and adjust below.',
  // The `_one` / `_other` rows below are count families (objectui#11445):
  // `useImportTranslation`'s fallback reads them for a numeric `count`.
  'grid.import.autoMatchedSummary_one': 'Auto-matched {{count}} column — review and adjust below.',
  'grid.import.autoMatchedSummary_other': 'Auto-matched {{count}} columns — review and adjust below.',
  'grid.import.confidence.high': 'High confidence',
  'grid.import.confidence.medium': 'Medium confidence',
  'grid.import.confidence.low': 'Low confidence',
  'grid.import.type.number': 'Number',
  'grid.import.type.boolean': 'Boolean',
  'grid.import.type.date': 'Date',
  'grid.import.type.datetime': 'Date & time',
  'grid.import.type.text': 'Text',
  'grid.import.status': 'Status',
  'grid.import.skipColumn': 'Skip column',
  'grid.import.skip': '— Skip —',
  'grid.import.mapped': 'Mapped',
  'grid.import.skipped': 'Skipped',
  'grid.import.rowsWithErrors': '{{count}} row(s) with errors',
  'grid.import.rowsWithErrors_one': '{{count}} row with errors',
  'grid.import.rowsWithErrors_other': '{{count}} rows with errors',
  'grid.import.rowsCorrected': '{{count}} row(s) corrected',
  'grid.import.rowsCorrected_one': '{{count}} row corrected',
  'grid.import.rowsCorrected_other': '{{count}} rows corrected',
  'grid.import.clickToFix': '— click a highlighted cell to fix it inline.',
  'grid.import.showingRows': 'Showing {{shown}} of {{total}} rows',
  'grid.import.importing': 'Importing… {{progress}}%',
  // Async (large-file) import — job queued + processed server-side.
  'grid.import.asyncQueued': 'Queued — preparing to import…',
  'grid.import.asyncProcessing': 'Importing {{processed}} of {{total}} rows… {{progress}}%',
  'grid.import.asyncLargeHint': 'This file is large, so it will be imported in the background.',
  'grid.import.largeSampleNotice': 'Previewing the first {{shown}} of {{total}} rows.',
  'grid.import.cancelImport': 'Cancel import',
  'grid.import.importCancelled': 'Import cancelled',
  'grid.import.resultsTruncated': 'Showing the first {{count}} row results (of {{total}}).',
  'grid.import.resultsTruncated_one': 'Showing the first {{count}} row result (of {{total}}).',
  'grid.import.resultsTruncated_other': 'Showing the first {{count}} row results (of {{total}}).',
  'grid.import.importComplete': 'Import Complete',
  'grid.import.importPartial': 'Import finished with errors',
  'grid.import.importFailed': 'Import failed',
  'grid.import.imported': '{{count}} imported',
  'grid.import.createdCount': '{{count}} created',
  'grid.import.createdCount_one': '{{count}} created',
  'grid.import.createdCount_other': '{{count}} created',
  'grid.import.updatedCount': '{{count}} updated',
  'grid.import.updatedCount_one': '{{count}} updated',
  'grid.import.updatedCount_other': '{{count}} updated',
  'grid.import.skippedCount': '{{count}} skipped',
  'grid.import.moreErrors': '…and {{count}} more errors',
  'grid.import.moreErrors_one': '…and {{count}} more error',
  'grid.import.moreErrors_other': '…and {{count}} more errors',
  'grid.import.downloadFailed': 'Download failed rows',
  // Write-mode / options (preview step)
  'grid.import.options': 'Import options',
  'grid.import.writeMode': 'When a row matches an existing record',
  'grid.import.writeModeOpt.insert': 'Always create new',
  'grid.import.writeModeOpt.update': 'Update existing (skip if no match)',
  'grid.import.writeModeOpt.upsert': 'Update if matched, else create',
  'grid.import.matchFields': 'Match on',
  'grid.import.matchFieldsPlaceholder': 'Choose match field(s)…',
  'grid.import.matchFieldsHint': 'Rows are matched to existing records by these field(s).',
  'grid.import.needMatchFields': 'Select at least one field to match on.',
  'grid.import.matchOnlyField': '(match only)',
  'grid.import.optCreateOptions': 'Keep unknown option values',
  'grid.import.optSkipBlankKey': 'Skip rows with a blank match value',
  'grid.import.optBackground': 'Import in the background',
  'grid.import.optBackgroundHint': '(runs as an undoable job)',
  // Server dry-run pre-check (small files, preview step)
  'grid.import.validate': 'Validate data',
  'grid.import.validating': 'Validating…',
  'grid.import.validateHint': 'Check every row against the server before importing.',
  'grid.import.validatePassed': 'All {{ok}} rows are valid.',
  'grid.import.validateFailed': '{{ok}} valid, {{errors}} with errors.',
  'grid.import.errorRowPrefix': 'Row {{row}}: ',
  // Friendly, localized renderings of the server's structured import errors —
  // driven off the error `code` so the raw English server text (with its
  // baked-in api-name and internal object name) never reaches the user.
  'grid.import.referenceNotFound': 'No matching record for "{{value}}"',
  'grid.import.referenceAmbiguous': '"{{value}}" matches more than one record — use a unique value or the record id',
  'grid.import.invalidBoolean': '"{{value}}" is not a valid true/false value',
  'grid.import.invalidNumber': '"{{value}}" is not a valid number',
  'grid.import.invalidDate': '"{{value}}" is not a valid date',
  'grid.import.invalidTime': '"{{value}}" is not a valid time',
  'grid.import.invalidOption': '"{{value}}" is not one of the allowed options',
  'grid.import.requiredValue': 'This field is required',
  'grid.import.matchAmbiguous': 'Matches more than one existing record — use a unique value or the record id',
  // Import-job history
  'grid.import.history': 'History',
  'grid.import.historyBack': 'Back to import',
  'grid.import.historyDescription': 'Recent imports for this object.',
  'grid.import.historyHint': 'Background import jobs, newest first.',
  'grid.import.historyRefresh': 'Refresh',
  'grid.import.historyLoading': 'Loading…',
  'grid.import.historyEmpty': 'No imports yet.',
  'grid.import.historyUnsupported': 'Import history isn’t available for this data source.',
  'grid.import.historyColStatus': 'Status',
  'grid.import.historyColRows': 'Rows',
  'grid.import.historyColResult': 'Result',
  'grid.import.historyColTime': 'When',
  'grid.import.errorCount': '{{count}} errors',
  'grid.import.errorCount_one': '{{count}} error',
  'grid.import.errorCount_other': '{{count}} errors',
  // Undo / logical rollback
  'grid.import.undoImport': 'Undo import',
  'grid.import.undoing': 'Undoing…',
  'grid.import.undoConfirm': 'Undo this import? Records it created will be deleted and records it updated will be restored to their previous values.',
  'grid.import.reverted': 'Undone',
  // A partial undo (the answer reads `success: false`): how many rows stayed,
  // and that undoing again retries only them. Each row's refusal is listed below.
  'grid.import.undoPartial': '{{count}} rows were not undone. Undo again to retry only those rows.',
  'grid.import.undoPartial_one': '{{count}} row was not undone. Undo again to retry only that row.',
  'grid.import.undoPartial_other': '{{count}} rows were not undone. Undo again to retry only those rows.',
  'grid.import.jobStatus.pending': 'Pending',
  'grid.import.jobStatus.running': 'Running',
  'grid.import.jobStatus.succeeded': 'Succeeded',
  'grid.import.jobStatus.failed': 'Failed',
  'grid.import.jobStatus.cancelled': 'Cancelled',
  'grid.import.cancel': 'Cancel',
  'grid.import.back': 'Back',
  'grid.import.next': 'Next',
  'grid.import.close': 'Close',
  'grid.import.importNRows': 'Import {{count}} Rows',
  'grid.import.importNRows_one': 'Import {{count}} Row',
  'grid.import.importNRows_other': 'Import {{count}} Rows',
  'grid.import.importingProgress': 'Importing…',
  'grid.import.required': 'Required',
  'grid.import.invalidType': 'Invalid {{type}}',
  'grid.import.legacyReferenceBlocked': 'Import blocked: {{fields}} are relation fields that need the server import route to resolve names into record IDs, and this connection doesn’t support it. Importing them as plain text would corrupt the data. Upgrade the backend/client, or unmap these columns and import them separately.',
  // Shown in the mapping step when a required field has no column mapped — the
  // reason the Next button is disabled. Field names are listed as `label (name)`.
  'grid.import.missingRequiredHint': 'Can’t continue — required field(s) not mapped: {{fields}}. Add a matching column to your file, or go back and upload one that includes it.',
  // Shown on the completion screen when the import ran via the legacy per-row
  // fallback (server `/import` route unavailable) — no server-side coercion.
  'grid.import.legacyFallbackNotice': 'Imported via a compatibility fallback: this connection doesn’t support the server import route, so values were saved as text without server-side type coercion. Upgrade the backend/client for full import support (type coercion and relation lookups).',
  // Shown when the server refuses import with 405 because the object does not
  // expose the import operation (objectstack#3391) — distinct from "route not found".
  'grid.import.notAllowed': 'This object is not open for import.',
  'grid.import.requiredMark': '*',
};

/** Apply `{{var}}` interpolation to a translation template. */
function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    // `split(needle).join(value)` — deliberately not `replace`, and not
    // `replaceAll` either (objectui#4370, the hand-rolled copy of the shared
    // helper's objectui#3418 fix). This path must agree with i18next, which
    // serves the *provider* path; any divergence is a silent fork that only
    // shows up on provider-less hosts, where we are least likely to see it.
    //
    // The `g`-flagged RegExp this replaced already covered repeated
    // placeholders, but NOT the other half: `replace` and `replaceAll` both
    // interpret `$&`, `` $` ``, `$'` and `$$` in the *replacement* string,
    // and i18next does not. That harm lives in the replacement, not the
    // needle, so the flag could never reach it — a field label `Total$&`
    // rendered the `{{fields}}` placeholder back into the hint. Values here
    // are authored metadata (field labels, type names), so it was reachable.
    //
    // Retiring the RegExp also retires an unescaped needle: the placeholder
    // name went into a pattern uninterpolated, so a name carrying regex
    // metacharacters would have matched more than itself. Inert while every
    // name is a bare identifier, and now structurally impossible.
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

/** Translation hook with safe English fallback for standalone usage.
 *  When no I18nProvider is mounted (e.g. unit tests) the hook still resolves
 *  `grid.import.*` keys via the embedded defaults so the wizard stays usable. */
/** The defaults are English, so English plural rules pick a family's row. */
const EN_PLURAL_RULES = new Intl.PluralRules('en');

/**
 * A count family's `_one` / `_other` row for a NUMERIC count, else the base row
 * — the order i18next reads the `en` pack in (i18next plural-selects nothing
 * but a number). The hand-rolled copy of `createSafeTranslation`'s
 * `defaultsRowFor` (objectui#11445), as `interpolate` above is of its interpolator.
 */
function defaultsRow(key: string, vars?: Record<string, unknown>): string | undefined {
  const count = vars?.count;
  if (typeof count === 'number' && Number.isFinite(count)) {
    const slot = IMPORT_DEFAULT_TRANSLATIONS[`${key}_${EN_PLURAL_RULES.select(count)}`];
    if (slot !== undefined) return slot;
  }
  return IMPORT_DEFAULT_TRANSLATIONS[key];
}

function useImportTranslation(): { t: (key: string, vars?: Record<string, unknown>) => string } {
  const fallback = (key: string, vars?: Record<string, unknown>) =>
    interpolate(defaultsRow(key, vars) ?? key, vars);
  // Deliberately NOT `createSafeTranslation`: that probes one testKey and then
  // serves defaults for everything, whereas the wizard falls back per key so a
  // host dictionary that covers the common keys but lags on newer ones still
  // resolves what it has. No try/catch either — `useObjectTranslation` is
  // provider-safe, and wrapping a hook in try/catch violates rules-of-hooks
  // (objectui#2879, same class as #2595/#2596).
  const result = useObjectTranslation();
  const probe = result.t('grid.import.title');
  if (probe === 'grid.import.title') return { t: fallback };
  return {
    t: (key, vars) => {
      const v = result.t(key, vars as Record<string, unknown> | undefined);
      return v === key ? fallback(key, vars) : v;
    },
  };
}

/** @internal — exported solely for unit tests. */
export const __testables = {
  get interpolate() { return interpolate; },
  get mappingToTemplatePayload() { return mappingToTemplatePayload; },
  get applyTemplate() { return applyTemplate; },
  get loadTemplates() { return loadTemplates; },
  get saveTemplates() { return saveTemplates; },
  get autoMapColumns() { return autoMapColumns; },
  get isUnsupportedImport() { return isUnsupportedImport; },
  get mappedReferenceFields() { return mappedReferenceFields; },
  get formatDryRunError() { return formatDryRunError; },
  get isUnsupportedImportJob() { return isUnsupportedImportJob; },
  get isImportNotAllowed() { return isImportNotAllowed; },
  get jobResultToImportResult() { return jobResultToImportResult; },
  get buildFailedRowsCsv() { return buildFailedRowsCsv; },
  get assembleImportRequest() { return assembleImportRequest; },
  get sourceRowsToCsv() { return sourceRowsToCsv; },
  get isImportJobActive() { return isImportJobActive; },
  get isImportJobUndoable() { return isImportJobUndoable; },
  get buildSourceRows() { return buildSourceRows; },
  get summarizeSavedMapping() { return summarizeSavedMapping; },
  get savedMappingToDisplayIndexMap() { return savedMappingToDisplayIndexMap; },
  get checkImportCell() { return checkImportCell; },
  get parseImportNumber() { return parseImportNumber; },
  get mergeRowFindings() { return mergeRowFindings; },
  get transformedSourceColumns() { return transformedSourceColumns; },
  /** The read-only server-mapping summary table. Exposed so its cells can be
   *  read directly: reaching it through the wizard means driving a file parse
   *  and a Radix `Select`, neither of which this component owns. */
  get SavedMappingSummary() { return SavedMappingSummary; },
};

/** A reusable column-mapping template, persisted across sessions. Keys are
 *  CSV header names (case-insensitive) so a template can apply across files
 *  whose columns are reordered or sparsely present. */
export interface ImportMappingTemplate {
  id: string;
  name: string;
  /** Map of CSV header name → object field name. */
  mapping: Record<string, string>;
  updatedAt: number;
}

/** Minimal localStorage-shaped contract; injectable for tests. */
export interface ImportTemplateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ImportWizardProps {
  objectName: string;
  objectLabel?: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    /** Allowed values for select/enum fields. Accepts option objects or bare
     *  strings. */
    options?: Array<{ label?: string; value?: string | number } | string>;
    /** Storage-backed but non-writable target (autonumber / readonly): mappable
     *  so update/upsert can MATCH rows on it (e.g. "update the row whose record
     *  number already exists"), rendered with a "(match only)" hint. The value
     *  still travels in the row — the server needs it to locate the record; the
     *  engine strips readonly values from updates and respects explicitly
     *  seeded values on insert. */
    matchOnly?: boolean;
    /** Which rule the preview checks an `email` column's cells by. Left out,
     *  it is the record validator's rule, the one the generic import meets.
     *  `'identity'` is the user import endpoint's own rule (printable ASCII,
     *  at most 254 characters, no placeholder address), for a host
     *  that writes the column through that endpoint, as the identity import
     *  does. Only an `email` field reads it. */
    emailRule?: 'identity';
  }>;
  dataSource: any;
  onComplete?: (result: ImportResult) => void;
  onCancel?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Error handling strategy: 'skip' skips invalid rows, 'stop' aborts on first error. @default 'skip' */
  onErrorMode?: 'skip' | 'stop';
  /** Override the storage key under which mapping templates are persisted.
   *  Defaults to `objectui:import-templates:${objectName}`. */
  templateStorageKey?: string;
  /** Override the storage backend (defaults to window.localStorage). Use this
   *  to disable persistence (`null`) or to inject an in-memory store in tests. */
  templateStorage?: ImportTemplateStorage | null;
  /** Registered server-side import mappings for this object (objectstack-ai/objectstack#2611).
   *  When omitted, the wizard fetches them via `dataSource.listImportMappings`
   *  (feature-detected). Pass explicitly to override / for tests. */
  savedMappings?: SavedMapping[];
  /** Pre-loaded spreadsheet (cloud#797 Excel→App): when the wizard opens with
   *  this set, it parses the File in memory and jumps straight to the mapping
   *  step, skipping the upload UI. Used by the AI build panel to hand off an
   *  already-attached Excel/CSV so the user goes from "one sentence → app" to
   *  "my real data is in it" without re-picking the file. Ignored on reopen
   *  once consumed. */
  initialFile?: File;
  /** Extra content rendered above the write-options panel on the preview step.
   *  Hosts inject domain-specific import options here (e.g. the identity
   *  import's password policy — framework#2782); any state it collects flows
   *  back through the host's own `dataSource` wrapper, so the wizard stays
   *  backend-agnostic. */
  extraOptionsContent?: React.ReactNode;
  /** Render extra content at the top of the result step — e.g. one-time
   *  credentials a domain-specific import endpoint returned in
   *  `result.serverResult` (framework#2782). */
  renderResultExtra?: (result: ImportResult) => React.ReactNode;
  /** The write modes the target's import door accepts, in the order offered.
   *  Left out, all three (`insert`, `update`, `upsert`). A host that writes
   *  through a narrower door passes that door's set (the identity import
   *  accepts `insert` and `upsert` only — objectui#12697), so the wizard never
   *  offers a mode the write would refuse: the select lists only these, the
   *  start mode is `insert` when offered (else the first), and a saved mapping
   *  whose mode is not offered is listed disabled and cannot be picked. An
   *  empty list is a host error and throws. */
  writeModes?: readonly ImportWriteMode[];
}

/** Every write mode the generic import door accepts — the wizard's offer when
 *  the host names no narrower set (`ImportWizardProps.writeModes`). */
const ALL_WRITE_MODES: readonly ImportWriteMode[] = ['insert', 'update', 'upsert'];

/** A write mode's label. One literal key per mode, so the language-pack key
 *  census sees every member (no template key). Read by the write-mode select
 *  and by the saved-mapping selector's refused-mode note. */
function writeModeLabel(t: (key: string) => string, mode: ImportWriteMode): string {
  switch (mode) {
    case 'insert': return t('grid.import.writeModeOpt.insert');
    case 'update': return t('grid.import.writeModeOpt.update');
    case 'upsert': return t('grid.import.writeModeOpt.upsert');
  }
}

export interface ImportResult {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: Array<{ row: number; field: string; message: string; code?: string }>;
  /** Rows that created a new record (server-side import). */
  createdRows?: number;
  /** Rows that updated an existing record (server-side import). */
  updatedRows?: number;
  /** The raw per-row server result, when the server `/import` path was used. */
  serverResult?: ImportRecordsResult;
  /** True when an async job's per-row `errors` were capped by the server. */
  resultsTruncated?: boolean;
  /** True when the user cancelled an in-flight async import job. */
  cancelled?: boolean;
  /** True when the import ran via the legacy per-row `create` fallback because
   *  the server `/import` route was unavailable — values are written as-is,
   *  with no server-side type coercion or reference resolution. Surfaced on the
   *  completion screen so a silent downgrade never passes for a full import. */
  degraded?: boolean;
}

type WizardStep = 'upload' | 'mapping' | 'preview';

/**
 * The result screen's headline ("Import Complete" / "Import cancelled") is
 * rendered as the dialog's `DialogDescription`, so the finished state is what
 * `aria-describedby` names and the header shows no stale subtitle above it
 * (objectui#13124). These classes override the primitive's `text-sm
 * text-muted-foreground` so the headline looks as it did as a plain paragraph.
 */
const RESULT_HEADLINE_CLASS = 'text-lg font-semibold text-foreground';

/**
 * What a finished import amounts to, read from the result the wizard already
 * holds (objectui#13230). A row the import deliberately skipped (`ok: true`,
 * action `skipped` — a skip-existing or no-match choice) is not an error, so
 * only `errors` counts against the import. Every failure path leaves an entry
 * there: an `ok: false` row carries its row number, while a refused (405) or
 * thrown request, and a failed job with no row report, carry one row-0 entry
 * with the request's message. A background job that ended `failed` is read
 * from the job's own final status, since a worker can crash after committing
 * some rows.
 * - `failed`: the job ended `failed`, or nothing was imported and something errored.
 * - `partial`: at least one row imported and at least one errored.
 * - `success`: otherwise — including every row deliberately skipped.
 * - `cancelled`: the user cancelled the job.
 */
type ImportOutcome = 'success' | 'partial' | 'failed' | 'cancelled';

function importResultOutcome(
  result: Pick<ImportResult, 'importedRows' | 'errors' | 'cancelled'>,
  jobStatus?: ImportJobStatus | null,
): ImportOutcome {
  if (result.cancelled) return 'cancelled';
  if (jobStatus === 'failed') return 'failed';
  if (result.errors.length === 0) return 'success';
  return result.importedRows > 0 ? 'partial' : 'failed';
}

const RESULT_HEADLINE_KEY: Record<ImportOutcome, string> = {
  success: 'grid.import.importComplete',
  partial: 'grid.import.importPartial',
  failed: 'grid.import.importFailed',
  cancelled: 'grid.import.importCancelled',
};

/** Maximum number of rows to show in the preview step */
const PREVIEW_ROW_COUNT = 10;

/**
 * Row count above which the wizard prefers an asynchronous import job (when the
 * data source supports it) instead of the synchronous single-call import. Kept
 * in step with the server's synchronous `/import` ceiling (`maxRows: 5000`), so
 * files the sync route would reject with 413 are routed to a background job.
 */
const ASYNC_IMPORT_THRESHOLD = 5000;

/** How often (ms) to poll an in-flight import job for progress. */
const IMPORT_JOB_POLL_INTERVAL = 800;

/** Text colour for the auto-match confidence hint, keyed by confidence bucket. */
const CONFIDENCE_CLASS: Record<MappingConfidence, string> = {
  high: 'text-emerald-600',
  medium: 'text-sky-600',
  low: 'text-muted-foreground',
};

/** Mapped fields whose type the legacy fallback cannot import safely. */
function mappedReferenceFields(
  mapping: Record<number, string>,
  fields: ImportWizardProps['fields'],
): ImportWizardProps['fields'] {
  const mappedNames = new Set(Object.values(mapping));
  return fields.filter((f) => mappedNames.has(f.name) && REFERENCE_IMPORT_TYPES.has(f.type));
}

/** Pull the first double-quoted token out of a server error message — e.g.
 *  `no os_..._product matches "导管架"` → `导管架`. A locale-agnostic fallback for
 *  naming the offending value when it can't be read back from the row. */
function extractQuotedValue(message?: string): string | undefined {
  const m = message?.match(/"([^"]*)"/);
  return m?.[1];
}

/**
 * Turn one failed dry-run row into a friendly, localizable error line.
 *
 * The server keys each error by a field's api-name, bakes that same api-name
 * into an English message (`product: no os_..._product matches "..."`), and
 * tags it with a structured `code`. Rendered verbatim that reads as
 * `产品: product: no os_..._product matches "..."` — the field twice, an
 * internal object name, all in English. So we drive the message off `code`
 * (localized, with the offending value), resolve the api-name to its human
 * label, and only fall back to the raw server text — minus any duplicated
 * `<api-name>:` prefix — for codes we don't recognize.
 */
function formatDryRunError(
  r: Pick<ImportRowResult, 'field' | 'error' | 'code'>,
  fieldLabelByName: Map<string, string>,
  value: string | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string,
): { fieldLabel?: string; message: string } {
  const fieldLabel = r.field ? (fieldLabelByName.get(r.field) ?? r.field) : undefined;
  // Prefer the value the row actually supplied; fall back to the token the
  // server echoed into its message.
  const shown = (value ?? '').trim() || extractQuotedValue(r.error) || '';
  switch (r.code) {
    case 'reference_not_found':
      return { fieldLabel, message: t('grid.import.referenceNotFound', { value: shown }) };
    case 'reference_ambiguous':
      return { fieldLabel, message: t('grid.import.referenceAmbiguous', { value: shown }) };
    case 'invalid_boolean':
      return { fieldLabel, message: t('grid.import.invalidBoolean', { value: shown }) };
    case 'invalid_number':
      return { fieldLabel, message: t('grid.import.invalidNumber', { value: shown }) };
    case 'invalid_date':
      return { fieldLabel, message: t('grid.import.invalidDate', { value: shown }) };
    case 'invalid_time':
      return { fieldLabel, message: t('grid.import.invalidTime', { value: shown }) };
    case 'invalid_option':
      return { fieldLabel, message: t('grid.import.invalidOption', { value: shown }) };
    case 'required':
      return { fieldLabel, message: t('grid.import.requiredValue') };
    case 'AMBIGUOUS_MATCH':
      return { fieldLabel, message: t('grid.import.matchAmbiguous') };
  }
  let message = (r.error ?? r.code ?? '').trim();
  // Drop a leading `<api-name>:` the server prepended, so it isn't shown on top
  // of the label we render.
  if (r.field && message.toLowerCase().startsWith(`${r.field.toLowerCase()}:`)) {
    message = message.slice(r.field.length + 1).trimStart();
  }
  return { fieldLabel, message };
}

// ── The preview's cell check (objectui#11814) ─────────────────────────────
//
// A cell is flagged here only where the server's import refuses it, because the
// import button counts the rows nobody has flagged: a check stricter than the
// server would shrink that count below what the import then writes. The server
// side lives in the framework: `coerceFieldValue` and its helpers in
// `packages/core/src/utils/import-coerce.ts`, then the engine's `validateRecord`.

/** One mapped target field of the import. */
type ImportTargetField = ImportWizardProps['fields'][number];
type ImportTargetOption = NonNullable<ImportTargetField['options']>[number];

/** The only comma a numeric cell may carry: a thousands grouping of its integer part. */
const THOUSANDS_GROUPED_INTEGER = /^[+-]?\d{1,3}(?:,\d{3})+(?![\d,])[^,]*$/;

/**
 * A numeric cell read the way the server's `parseNumberCell` reads it, or
 * `undefined` where the server answers `invalid_number`. It takes a thousands
 * grouping, one leading currency symbol, a trailing percent sign and an
 * accounting-style parenthesised negative, and nothing else.
 *
 * `Number()` did this job before and disagreed with the server both ways: it
 * refused `1,234`, `$12` and `25%`, which the server takes, and took `0x10`,
 * `Infinity` and `12.`, which the server refuses.
 */
function parseImportNumber(cell: string): number | undefined {
  let s = cell.trim();
  if (s === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[$¥€£￥]\s*/, '');
  s = s.replace(/%$/, '').trim();
  if (s.includes(',')) {
    if (!THOUSANDS_GROUPED_INTEGER.test(s)) return undefined;
    s = s.replace(/,/g, '');
  }
  if (s === '' || !/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** An option's stored value and its label; a bare-string option is both. */
function optionValueAndLabel(option: ImportTargetOption): { value?: string; label?: string } {
  if (typeof option === 'string') return { value: option, label: option };
  return {
    value: option?.value === undefined ? undefined : String(option.value),
    label: typeof option?.label === 'string' ? option.label : undefined,
  };
}

/**
 * Whether the server's `matchOption` takes this cell: the trimmed cell equals
 * an option's value exactly, or equals its trimmed label ignoring case. A field
 * with no options takes anything.
 */
function matchesImportOption(cell: string, options: readonly ImportTargetOption[]): boolean {
  if (options.length === 0) return true;
  const s = cell.trim();
  const lower = s.toLowerCase();
  return options.some((option) => {
    const { value, label } = optionValueAndLabel(option);
    return value === s || (label !== undefined && label.trim().toLowerCase() === lower);
  });
}

/** A multi-value cell split the way the server's `splitMulti` splits it. */
function splitImportMultiValue(cell: string): string[] {
  return cell.split(/[,;、\n]/).map((v) => v.trim()).filter((v) => v !== '');
}

/**
 * The value the server refuses in a select / multiselect cell, or `undefined`
 * when it takes the cell. The option types come from the spec, as the server
 * reads them: a multi-option type is split and each token matched.
 *
 * One reading is not the server's exactly, and it errs towards taking a cell:
 * a `select` / `radio` flagged `multiple: true` is split by the server as well,
 * and the wizard's field shape does not carry `multiple`. So a single-option
 * cell is refused only when both readings refuse it: as one value, and as a
 * split list.
 *
 * With *Keep unknown option values* on (the request's `createMissingOptions`),
 * the server takes every option cell, on a writable field and a `matchOnly`
 * one alike: its coercion keeps a value that matches no option (a single-value
 * cell trimmed, each unmatched item of a multi-value cell), and the engine's
 * option check admits exactly the values that import kept, on that import's
 * writes, dry run included (objectstack#22183). So the setting spares every
 * option field. The field's options do not change. The one case the server
 * still refuses with the setting on is a field bound to a shared picklist that
 * did not resolve; the wizard's field shape does not say a field is bound to a
 * picklist, so the preview does not model that case either way.
 */
function refusedOptionValue(
  cell: string,
  field: ImportTargetField,
  keepUnknownOptions: boolean,
): string | undefined {
  const options = field.options ?? [];
  if (options.length === 0) return undefined;
  if (keepUnknownOptions) return undefined;
  const fits = (token: string) => matchesImportOption(token, options);
  if (MULTI_OPTION_TYPES.has(field.type)) return splitImportMultiValue(cell).find((token) => !fits(token));
  if (!SINGLE_OPTION_TYPES.has(field.type)) return undefined;
  if (fits(cell) || splitImportMultiValue(cell).every(fits)) return undefined;
  return cell.trim();
}

/** Why the server will refuse a cell, as the preview reports it. */
type CellRefusal =
  | { code: 'required' }
  | {
      code: 'invalid_number' | 'invalid_boolean' | 'invalid_date' | 'invalid_time' | 'invalid_email' | 'invalid_option';
      /** The refused value: the trimmed cell, or the refused token of a multi-value cell. */
      value: string;
    };

/** What the check needs to know about this import beyond the cell and its field. */
interface CellCheckOptions {
  /** The *Keep unknown option values* setting the import request carries. */
  keepUnknownOptions: boolean;
  /**
   * Whether a blank cell in a required field is refused. Only a create is: the
   * engine never asks an update for a field the row leaves out, and the import
   * leaves a blank cell out.
   */
  requireValues: boolean;
}

/**
 * The reason the server refuses this cell, or `undefined` when it takes it. A
 * blank or whitespace-only cell is empty, as the server's `isBlank` reads it.
 *
 * The arms run in the order the server's `coerceFieldValue` runs them, and the
 * boolean and numeric types are the spec's sets, the ones the server reads, so
 * `toggle`, `rating`, `slider` and `progress` are checked like `boolean` and
 * `number` (objectui#11889). A `date` / `datetime` cell is read by the server's
 * grammar and supported years, and an `email` cell by the record validator's
 * rule, which takes a non-ASCII address (both in `importCoercionContract.ts`).
 * A `time` cell is read the way the server reads a time of day, and an `email`
 * column flagged `emailRule: 'identity'` by the user import endpoint's rule
 * instead of the record validator's (objectui#11913).
 */
function checkImportCell(
  cell: string,
  field: ImportTargetField,
  opts: CellCheckOptions,
): CellRefusal | undefined {
  const value = cell.trim();
  if (value === '') return field.required && opts.requireValues ? { code: 'required' } : undefined;
  const { type } = field;
  if (BOOLEAN_VALUE_TYPES.has(type)) {
    return BOOLEAN_IMPORT_TOKENS.has(value.toLowerCase()) ? undefined : { code: 'invalid_boolean', value };
  }
  if (NUMERIC_VALUE_TYPES.has(type)) {
    return parseImportNumber(value) === undefined ? { code: 'invalid_number', value } : undefined;
  }
  if (type === 'date' || type === 'datetime') {
    return isImportableDateCell(value, type) ? undefined : { code: 'invalid_date', value };
  }
  if (type === 'time') return isImportableTimeCell(value) ? undefined : { code: 'invalid_time', value };
  if (type === 'email') {
    const takes = field.emailRule === 'identity' ? isIdentityEmail(value) : isRecordEmail(value);
    return takes ? undefined : { code: 'invalid_email', value };
  }
  const refused = refusedOptionValue(cell, field, opts.keepUnknownOptions);
  return refused === undefined ? undefined : { code: 'invalid_option', value: refused };
}

/** The sentence a cell refusal reads as: the one the server's code reads as, where one exists. */
function cellRefusalMessage(
  refusal: CellRefusal,
  field: ImportTargetField,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  switch (refusal.code) {
    case 'required': return t('grid.import.requiredValue');
    case 'invalid_number': return t('grid.import.invalidNumber', { value: refusal.value });
    case 'invalid_boolean': return t('grid.import.invalidBoolean', { value: refusal.value });
    case 'invalid_date': return t('grid.import.invalidDate', { value: refusal.value });
    case 'invalid_time': return t('grid.import.invalidTime', { value: refusal.value });
    case 'invalid_option': return t('grid.import.invalidOption', { value: refusal.value });
    case 'invalid_email': return t('grid.import.invalidType', { type: field.type });
  }
}

/**
 * Auto-map source columns to object fields, Airtable-style. Delegates to
 * {@link suggestColumnMappings} (name/label similarity + bilingual synonyms +
 * token overlap + content-inferred type gating, assigned globally by
 * confidence) and keeps only the confidently-matched columns. `rows` is
 * optional; without it only name-based signals fire.
 */
function autoMapColumns(
  headers: string[],
  fields: ImportWizardProps['fields'],
  rows?: string[][],
): Record<number, string> {
  const mapping: Record<number, string> = {};
  for (const s of suggestColumnMappings(headers, fields, rows)) {
    if (s.fieldName) mapping[s.columnIndex] = s.fieldName;
  }
  return mapping;
}

/** Resolve the storage backend, defaulting to window.localStorage when available. */
function defaultTemplateStorage(): ImportTemplateStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

/** Load and persist named mapping templates. Header keys are stored
 *  case-insensitively so templates apply across files with different casing. */
function loadTemplates(storage: ImportTemplateStorage | null, key: string): ImportMappingTemplate[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.name && t.mapping) : [];
  } catch { return []; }
}

function saveTemplates(storage: ImportTemplateStorage | null, key: string, templates: ImportMappingTemplate[]) {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify(templates)); } catch { /* quota etc */ }
}

/** Convert an index-based mapping back to a header-name template payload. */
function mappingToTemplatePayload(headers: string[], mapping: Record<number, string>): Record<string, string> {
  const payload: Record<string, string> = {};
  Object.entries(mapping).forEach(([idx, fieldName]) => {
    const header = headers[Number(idx)];
    if (header) payload[header.trim().toLowerCase()] = fieldName;
  });
  return payload;
}

/** Apply a header-name template to current headers, producing an index map. */
function applyTemplate(
  template: ImportMappingTemplate,
  headers: string[],
  fields: ImportWizardProps['fields'],
): Record<number, string> {
  const validFieldNames = new Set(fields.map((f) => f.name));
  const next: Record<number, string> = {};
  headers.forEach((header, idx) => {
    const fieldName = template.mapping[header.trim().toLowerCase()];
    if (fieldName && validFieldNames.has(fieldName)) next[idx] = fieldName;
  });
  return next;
}

type MappedCol = { csvIdx: number; field: ImportTargetField };

/**
 * The legacy per-row `create` path's check. Every write there is a create, so a
 * required field's blank cell is always refused.
 */
function validateRow(row: string[], mappedCols: MappedCol[], rowIndex: number, keepUnknownOptions: boolean) {
  const errors: ImportResult['errors'] = [];
  const record: Record<string, any> = {};
  for (const col of mappedCols) {
    const raw = row[col.csvIdx] ?? '';
    const refusal = checkImportCell(raw, col.field, { keepUnknownOptions, requireValues: true });
    if (refusal?.code === 'required') {
      errors.push({ row: rowIndex, field: col.field.name, message: 'Required field is empty' });
      continue;
    }
    if (refusal) {
      errors.push({ row: rowIndex, field: col.field.name, message: `Invalid ${col.field.type} value: "${refusal.value}"` });
      continue;
    }
    record[col.field.name] = raw;
  }
  return { record, errors };
}

/** One reason a row will not import: the preview's own check, or the server's dry run. */
type RowFinding =
  | { source: 'client'; field: ImportTargetField; csvIdx: number; refusal: CellRefusal }
  | { source: 'server'; result: ImportRowResult; csvIdx?: number };

/** The preview's findings on the rows it checked, keyed by 0-based row index. */
type ClientFindings = Map<number, Array<Extract<RowFinding, { source: 'client' }>>>;

/** The client findings for one row, in column order. Empty when the row passes. */
function checkImportRow(
  row: readonly string[],
  checkedCols: readonly MappedCol[],
  opts: CellCheckOptions,
): Array<Extract<RowFinding, { source: 'client' }>> {
  const out: Array<Extract<RowFinding, { source: 'client' }>> = [];
  for (const col of checkedCols) {
    const refusal = checkImportCell(row[col.csvIdx] ?? '', col.field, opts);
    if (refusal) out.push({ source: 'client', field: col.field, csvIdx: col.csvIdx, refusal });
  }
  return out;
}

/**
 * One list of findings per row: the preview's own, then each server dry-run
 * failure on a field the preview has not already flagged in that row. Rows are
 * 0-based indexes into the loaded rows; the dry run numbers them from 1. A dry
 * run result with no row of its own (row 0) is a refusal of the whole request,
 * returned apart.
 */
function mergeRowFindings(
  client: ClientFindings,
  dryRun: ImportRecordsResult | null,
  csvIdxByField: ReadonlyMap<string, number>,
  rowCount: number,
): { byRow: Map<number, RowFinding[]>; request: ImportRowResult[] } {
  const byRow = new Map<number, RowFinding[]>();
  for (const [rIdx, findings] of client) {
    if (findings.length > 0) byRow.set(rIdx, [...findings]);
  }
  const request: ImportRowResult[] = [];
  for (const result of dryRun?.results ?? []) {
    if (result.ok) continue;
    const rIdx = result.row - 1;
    if (!(rIdx >= 0 && rIdx < rowCount)) { request.push(result); continue; }
    const list = byRow.get(rIdx) ?? [];
    const duplicate = result.field !== undefined
      && list.some((f) => f.source === 'client' && f.field.name === result.field);
    if (duplicate) continue;
    list.push({ source: 'server', result, csvIdx: result.field ? csvIdxByField.get(result.field) : undefined });
    byRow.set(rIdx, list);
  }
  return { byRow, request };
}

/**
 * The columns of a named server mapping whose values the server transforms
 * (`map`, `lookup`, …) before coercing them. The preview cannot predict a
 * transformed value, so it does not check those columns.
 */
function transformedSourceColumns(m: SavedMapping | null, headers: string[]): Set<number> {
  const out = new Set<number>();
  if (!m) return out;
  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => { if (h) headerIndex.set(h.trim().toLowerCase(), idx); });
  for (const e of m.fieldMapping ?? []) {
    if (!e.transform || e.transform === 'none') continue;
    for (const source of Array.isArray(e.source) ? e.source : [e.source]) {
      const idx = headerIndex.get(String(source).trim().toLowerCase());
      if (idx !== undefined) out.add(idx);
    }
  }
  return out;
}

/** One CSV cell, quoted when it holds a comma, a double quote, a CR or an LF
 *  (RFC 4180). The import door's CSV parser opens a quoted run at ANY double
 *  quote and drops a bare CR, so a value carrying either travels quoted too. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text of the request's rows — SOURCE-keyed for a named mapping (see
 *  buildSourceRows), field-keyed on the hand-mapped path: a header row naming
 *  every column the rows carry, then one line per row. The cells are the ones
 *  the JSON rows would carry, so a corrected cell, a pasted table and an .xlsx
 *  sheet travel exactly as the preview shows them (objectui#13156). The columns
 *  are read off the rows, so the text and the rows cannot disagree. */
function sourceRowsToCsv(rows: ReadonlyArray<Record<string, string>>): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) { seen.add(column); columns.push(column); }
    }
  }
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
}

/** Assemble the server `/import` request from mapping-applied raw rows plus the
 *  current write-mode + coercion options. Kept pure (no component state) so the
 *  real import and the dry-run pre-check send byte-identical payloads and it can
 *  be unit-tested. `matchFields` is only sent when the write-mode consults it.
 *
 *  The request never carries the two control opt-outs, `runAutomations: false`
 *  and `treatAsHistorical: true`: both import doors honour them for the system
 *  principal only and refuse every signed-in caller `403 PERMISSION_DENIED`
 *  (objectstack-ai/objectstack#24348), so the wizard does not offer them
 *  (objectui#12985). Omitting both keys is the server's declared default —
 *  automations run and the state machine is walked. */
function assembleImportRequest(
  rows: Record<string, string>[],
  opts: {
    writeMode: ImportWriteMode;
    matchFields: string[];
    createMissingOptions: boolean;
    skipBlankMatchKey: boolean;
    dryRun?: boolean;
    /** When set, the server resolves this registered mapping and owns the
     *  rename + transform + write semantics (objectstack-ai/objectstack#2611). `rows` must
     *  then carry SOURCE headers (see buildSourceRows), and the inline
     *  column mapping / write-mode are omitted — mutually exclusive per the
     *  server contract. */
    mappingName?: string;
    /** The `sourceFormat` that named mapping declares, read off the mapping the
     *  server serves and never inferred from the uploaded file's name. The
     *  import door judges the declaration against the payload and refuses JSON
     *  rows for a `csv` mapping (`400 MAPPING_FORMAT_MISMATCH`, objectui#13156),
     *  so a `csv` mapping's rows travel as CSV text from any source, and a
     *  `json` mapping's as JSON rows from any source. An undeclared one follows
     *  the source, as the hand-mapped path does (`csvFile`). */
    mappingSourceFormat?: SavedMapping['sourceFormat'];
    /** The rows were read from a CSV file: a delimited-text file, by the name
     *  test `parseSpreadsheetFile` picks its text arm with
     *  (`delimitedFileDelimiter`). Its rows travel as CSV text, so the import
     *  door reads the file's cells through its own CSV rule — the one its CSV
     *  export pairs with (objectui#13315). The text is `sourceRowsToCsv(rows)`,
     *  the cells the preview parsed, never the file as uploaded. An .xlsx sheet
     *  and a paste keep JSON rows. */
    csvFile?: boolean;
  },
): ImportRequestOptions {
  // A `json`-declared mapping is the one CSV-file request that keeps JSON rows:
  // the door refuses CSV text for it (`MAPPING_FORMAT_MISMATCH`).
  const asCsv = opts.mappingName
    ? opts.mappingSourceFormat === 'csv' || (opts.csvFile === true && opts.mappingSourceFormat !== 'json')
    : opts.csvFile === true;
  const payload = asCsv
    ? { format: 'csv' as const, csv: sourceRowsToCsv(rows) }
    : { format: 'json' as const, rows };
  if (opts.mappingName) {
    return {
      ...payload,
      mappingName: opts.mappingName,
      ...(opts.dryRun ? { dryRun: true } : {}),
    };
  }
  return {
    ...payload,
    writeMode: opts.writeMode,
    ...(opts.writeMode !== 'insert' ? { matchFields: opts.matchFields } : {}),
    createMissingOptions: opts.createMissingOptions,
    skipBlankMatchKey: opts.skipBlankMatchKey,
    ...(opts.dryRun ? { dryRun: true } : {}),
  };
}

/** True when the adapter/client can't speak the server `/import` route, so the
 *  wizard should transparently fall back to a per-row `create` loop. */
function isUnsupportedImport(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'UNSUPPORTED_OPERATION') return true;
  const msg = err instanceof Error ? err.message : '';
  return /does not support data\.import|importRecords is not a function|\.import is not a function/i.test(msg);
}

/** True when the data source lacks the async import-job API (older
 *  adapter/client/server), so the wizard should fall back to the sync path. */
function isUnsupportedImportJob(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'UNSUPPORTED_OPERATION') return true;
  const msg = err instanceof Error ? err.message : '';
  return /does not support async import|createImportJob is not a function|import\/jobs|404/i.test(msg);
}

/** True when the SERVER refused the import because the object does not expose
 *  the import operation (405 / `OBJECT_API_METHOD_NOT_ALLOWED`, objectstack#3391).
 *
 *  The opposite of {@link isUnsupportedImportJob} (404 = the async-job ROUTE is
 *  absent → fall back to sync) and {@link isUnsupportedImport} (adapter can't
 *  speak `/import` → fall back to per-row create): a **405** means "this object
 *  is not open for import at all", so every fallback would 405 too. The wizard
 *  must STOP and show a dedicated message — never fall back. Checked BEFORE the
 *  unsupported predicates at every catch site so 405 wins over the 404/regex
 *  fall-back paths. */
function isImportNotAllowed(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'OBJECT_API_METHOD_NOT_ALLOWED') return true;
  const e = err as { status?: unknown; statusCode?: unknown; httpStatus?: unknown };
  if (e?.status === 405 || e?.statusCode === 405 || e?.httpStatus === 405) return true;
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /\b405\b|method not allowed/i.test(msg);
}

/** Map an async import-job's final results payload onto the wizard's
 *  {@link ImportResult} shape — identical to the synchronous mapping so the
 *  completion screen renders the same regardless of which path ran. */
function jobResultToImportResult(res: ImportJobResultsInfo): ImportResult {
  return {
    totalRows: res.total,
    importedRows: res.created + res.updated,
    skippedRows: res.skipped + res.errors,
    createdRows: res.created,
    updatedRows: res.updated,
    errors: (res.results ?? [])
      .filter((r) => !r.ok)
      .map((r) => ({ row: r.row, field: r.field ?? '', message: r.error ?? r.code ?? 'Import failed', code: r.code })),
    resultsTruncated: res.resultsTruncated,
  };
}

/** True while an import job is still in flight — it can be cancelled and the
 *  history list should keep polling it. Terminal states are the rest. */
function isImportJobActive(status: ImportJobStatus): boolean {
  return status === 'pending' || status === 'running';
}

/** Whether to show the "Undo import" button for a history row: the adapter must
 *  support undo, the job must be terminal, still undoable, and not already
 *  reverted. Mirrors the server's `importJobUndoable`. */
function isImportJobUndoable(job: Pick<ImportJobSummaryInfo, 'status' | 'undoable' | 'revertedAt'>, canUndo: boolean): boolean {
  return canUndo && !!job.undoable && !job.revertedAt && !isImportJobActive(job.status);
}

/** The statuses an import job never leaves. */
const IMPORT_JOB_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

/** How many progress reads the wizard spends, after the user cancels, waiting
 *  for the cancelled job's outcome (one read per {@link IMPORT_JOB_POLL_INTERVAL}). */
const IMPORT_JOB_CANCEL_SETTLE_READS = 10;

/** The wizard's result for a job that reads `cancelled`: the rows the server
 *  committed before the cancel took effect. One builder for both ways a job
 *  ends cancelled — the wizard's own Cancel and the poll loop seeing a job
 *  cancelled elsewhere (e.g. from the History list in another tab). */
function cancelledJobToImportResult(prog: ImportJobProgressInfo): ImportResult {
  return {
    totalRows: prog.total,
    importedRows: prog.created + prog.updated,
    skippedRows: prog.skipped + prog.errors,
    createdRows: prog.created,
    updatedRows: prog.updated,
    errors: [],
    cancelled: true,
  };
}

/** Whether a progress read is the job's final outcome, given the read before it.
 *
 *  A terminal status is enough for `succeeded` and `failed`: the worker writes
 *  them together with its final counts. It is not enough for `cancelled`. The
 *  server's cancel route marks the job row `cancelled` itself, before the
 *  worker notices; the worker keeps writing rows until its next progress
 *  boundary (cancel is cooperative — see `DataSource.cancelImportJob`), and
 *  only then writes the final counts and, for a job it can undo, the undo log.
 *  So a `cancelled` read is final once it is undoable (only that last write
 *  makes it so), or once it repeats the previous `cancelled` read's counts. */
function isSettledJobRead(prog: ImportJobProgressInfo, previous: ImportJobProgressInfo | null): boolean {
  if (!IMPORT_JOB_TERMINAL_STATUSES.has(prog.status)) return false;
  if (prog.status !== 'cancelled') return true;
  if (prog.undoable) return true;
  return previous !== null
    && previous.status === 'cancelled'
    && previous.processed === prog.processed
    && previous.created === prog.created
    && previous.updated === prog.updated
    && previous.skipped === prog.skipped
    && previous.errors === prog.errors;
}

/** Read a job until a read is its final outcome ({@link isSettledJobRead}), at
 *  most `reads` times: the first read at once, then one per `interval`. A read
 *  that fails counts against the bound and is otherwise skipped. Resolves to
 *  the settled read, or `null` when none settled or `isStale()` turned true. */
async function readSettledImportJob(
  read: (jobId: string) => Promise<ImportJobProgressInfo>,
  jobId: string,
  reads: number,
  interval: number,
  isStale: () => boolean,
): Promise<ImportJobProgressInfo | null> {
  let previous: ImportJobProgressInfo | null = null;
  for (let i = 0; i < reads; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    if (isStale()) return null;
    let prog: ImportJobProgressInfo;
    try {
      prog = await read(jobId);
    } catch {
      continue;
    }
    if (isSettledJobRead(prog, previous)) return prog;
    previous = prog;
  }
  return null;
}

/** What an Undo left for the list that ran it to show: the message of an undo
 *  that threw, or the answer of one that left rows unreverted. */
type ImportUndoOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'partial'; answer: ImportJobUndoResult };

/** The Undo action, shared by the History list and the cancelled-result
 *  screen: confirm (destructive + irreversible), roll the job back, tell the
 *  object's mounted readers their data changed (the undo deleted and restored
 *  records, so an open list refetches in place), hand anything the user must
 *  read to `onOutcome` (cleared to `null` when an undo starts), then call
 *  `onSettled` so the caller re-reads the job and the Undo button gives way to
 *  "Undone".
 *
 *  An answer of `success: false` is not a throw: the server reverted what it
 *  could, listed every row it did not revert in `failures`, and kept the job
 *  undoable for those rows only. So the readers still refetch, the outcome
 *  carries the answer, and the re-read job still offers Undo (objectui#13015). */
function useImportJobUndo(
  dataSource: unknown,
  objectName: string,
  t: (key: string, vars?: Record<string, unknown>) => string,
  onOutcome: (outcome: ImportUndoOutcome | null) => void,
  onSettled: () => void,
): { undoingId: string | null; undo: (jobId: string) => Promise<void> } {
  // Job id currently being undone (disables its Undo button + confirm).
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const undo = useCallback(async (jobId: string) => {
    const ds = dataSource as Partial<DataSource> | undefined;
    if (typeof ds?.undoImportJob !== 'function') return;
    if (typeof window !== 'undefined' && !window.confirm(t('grid.import.undoConfirm'))) return;
    setUndoingId(jobId); onOutcome(null);
    try {
      const answer = await ds.undoImportJob(jobId);
      notifyDataChanged({ objectName });
      if (!answer.success) onOutcome({ kind: 'partial', answer });
    } catch (err) {
      onOutcome({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setUndoingId(null);
      onSettled();
    }
  }, [dataSource, objectName, t, onOutcome, onSettled]);
  return { undoingId, undo };
}

/** How many distinct refusal sentences a partial-undo notice lists before it
 *  counts the rest, as the result screen does for row errors. */
const UNDO_REFUSAL_LIMIT = 10;

/** What an Undo left, drawn where the list that ran it shows it. A partial
 *  undo says how many rows stayed and that undoing again retries only them,
 *  then lists each refusal sentence the answer carries — the app's own words,
 *  a hook's or a rule's. Rows refused with the same sentence share one line,
 *  since one hook typically refuses many rows alike; the count above covers
 *  them all. */
const ImportUndoOutcomeNotice: React.FC<{
  outcome: ImportUndoOutcome;
  t: (key: string, vars?: Record<string, unknown>) => string;
  errorTestId: string;
  partialTestId: string;
}> = ({ outcome, t, errorTestId, partialTestId }) => {
  if (outcome.kind === 'error') {
    return <p className="text-xs text-destructive" data-testid={errorTestId}>{outcome.message}</p>;
  }
  const refusals = [...new Set(outcome.answer.failures.map((failure) => failure.error))];
  return (
    <div className="text-xs text-destructive" role="alert" data-testid={partialTestId}>
      <p>{t('grid.import.undoPartial', { count: outcome.answer.failed })}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {refusals.slice(0, UNDO_REFUSAL_LIMIT).map((refusal) => <li key={refusal}>{refusal}</li>)}
      </ul>
      {refusals.length > UNDO_REFUSAL_LIMIT && (
        <p className="text-muted-foreground">{t('grid.import.moreErrors', { count: refusals.length - UNDO_REFUSAL_LIMIT })}</p>
      )}
    </div>
  );
};

/** Build a CSV blob of failed rows for re-export: the original mapped columns
 *  plus an `_error` column, so a user can fix and re-import just the failures. */
function buildFailedRowsCsv(
  headers: string[],
  rows: string[][],
  mapping: Record<number, string>,
  errorsByRow: Map<number, string>,
): string {
  const cols = Object.keys(mapping).map(Number).sort((a, b) => a - b);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = [...cols.map((c) => headers[c] ?? `col${c}`), '_error'];
  const lines = [head.map(esc).join(',')];
  // errorsByRow is keyed by 1-based row number.
  for (const [rowNum, message] of errorsByRow) {
    const src = rows[rowNum - 1];
    if (!src) continue;
    lines.push([...cols.map((c) => esc(src[c] ?? '')), esc(message)].join(','));
  }
  return lines.join('\n');
}

/** Hand a fetched file to the browser as a download. No-op in non-DOM
 *  environments. */
function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The message for a failed import-template download (objectui#9600). The
 *  server judges the template like the import: 405 when the object is not open
 *  for import (the same answer the import itself gets, so the same message),
 *  403 when the caller may not create its records. There is no client-side
 *  template to fall back to. */
function templateDownloadErrorMessage(err: unknown, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (isImportNotAllowed(err)) return t('grid.import.notAllowed');
  const e = err as { code?: unknown; status?: unknown; httpStatus?: unknown } | undefined;
  if (e?.code === 'PERMISSION_DENIED' || e?.status === 403 || e?.httpStatus === 403) {
    return t('grid.import.templateNotPermitted');
  }
  return t('grid.import.templateDownloadFailed');
}

/** Map a thrown import-parse error code to a translated, user-facing message. */
function parseErrorMessage(err: unknown, t: (k: string, v?: Record<string, unknown>) => string): string {
  const code = err instanceof Error ? err.message : '';
  if (code === ImportParseError.LegacyXls) return t('grid.import.legacyXls');
  if (code === ImportParseError.Unsupported) return t('grid.import.unsupportedFile');
  return t('grid.import.parseFailed');
}

// Step 1: File Upload (CSV / Excel / paste)
const StepUpload: React.FC<{
  /** `csvFile`: the grid was read from a delimited-text file, not from a
   *  workbook or a paste (see `assembleImportRequest`). */
  onFileLoaded: (headers: string[], rows: string[][], csvFile: boolean) => void;
  /** Fetches the server's import template (objectui#9600). Absent ⇒ the
   *  template is not offered: there is no client-built fallback. */
  downloadTemplate?: () => Promise<Blob>;
  objectName: string;
  /** Localized display label — used for the template filename so a zh user
   *  downloads `合同-导入模板.xlsx` rather than `contracts-template.xlsx`. */
  objectLabel?: string;
}> = ({ onFileLoaded, downloadTemplate, objectName, objectLabel }) => {
  const { t } = useImportTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const handleDownloadTemplate = async () => {
    if (!downloadTemplate) return;
    setError(null); setTemplateBusy(true);
    try {
      const blob = await downloadTemplate();
      const base = sanitizeFileNameBase(
        t('grid.import.templateFileName', { object: objectLabel || objectName || 'import' }),
      );
      downloadBlob(`${base || 'import-template'}.xlsx`, blob);
    } catch (err) {
      setError(templateDownloadErrorMessage(err, t));
    } finally {
      setTemplateBusy(false);
    }
  };

  /** Validate a freshly-parsed grid and hand it to the wizard, or report why not. */
  const acceptParsed = useCallback((parsed: string[][], csvFile: boolean) => {
    if (parsed.length < 2) { setError(t('grid.import.fileNeedsHeader')); return false; }
    onFileLoaded(parsed[0], parsed.slice(1), csvFile);
    return true;
  }, [onFileLoaded, t]);

  const processFile = useCallback(async (file: File) => {
    setError(null); setBusy(true);
    try {
      acceptParsed(await parseSpreadsheetFile(file), delimitedFileDelimiter(file.name) !== null);
    } catch (err) {
      setError(parseErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }, [acceptParsed, t]);

  // Paste-to-import: while this step is mounted, intercept paste of tabular
  // data copied from Excel/Sheets. Ignored when focus is in a text input so we
  // don't hijack ordinary editing.
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && /^(input|textarea)$/i.test(el.tagName)) return;
    const data = e.clipboardData;
    if (!data) return;
    const parsed = parseClipboardTable(data.getData('text/html') || null, data.getData('text/plain') || null);
    if (!parsed) return;
    e.preventDefault();
    setError(null);
    if (!acceptParsed(parsed, false)) { /* message already set */ }
  }, [acceptParsed]);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div
        className={cn(
          'flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          busy && 'pointer-events-none opacity-60',
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void processFile(f); }}
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{busy ? t('grid.import.parsing') : t('grid.import.dragDrop')}</p>
        <label>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f); }} />
          <Button variant="outline" size="sm" asChild><span>{t('grid.import.browseFiles')}</span></Button>
        </label>
        <p className="flex items-center gap-1 text-xs text-muted-foreground/80">
          <ClipboardPaste className="h-3.5 w-3.5" /> {t('grid.import.pasteHint')}
        </p>
      </div>
      {downloadTemplate && (
        <div className="flex flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={templateBusy}
            onClick={() => { void handleDownloadTemplate(); }}
            data-testid="import-download-template"
          >
            <Download className="mr-1 h-4 w-4" /> {t('grid.import.downloadTemplate')}
          </Button>
          <p className="text-xs text-muted-foreground/70">{t('grid.import.downloadTemplateHint')}</p>
        </div>
      )}
      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}
    </div>
  );
};

// Template bar for save / load / delete of column-mapping templates.
const TemplateBar: React.FC<{
  templates: ImportMappingTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSaveAs: (name: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}> = ({ templates, selectedId, onSelect, onSaveAs, onDelete, disabled }) => {
  const { t } = useImportTranslation();
  const [savingName, setSavingName] = useState('');
  const [showSave, setShowSave] = useState(false);
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2"
      data-testid="import-template-bar"
    >
      <Save className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs font-medium text-muted-foreground">{t('grid.import.mappingTemplate')}</span>
      <Select
        value={selectedId ?? '__none__'}
        onValueChange={(v) => v !== '__none__' && onSelect(v)}
      >
        <SelectTrigger className="h-7 w-48 text-xs" data-testid="import-template-select">
          <SelectValue placeholder={templates.length ? t('grid.import.chooseTemplate') : t('grid.import.noSavedTemplates')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" disabled={templates.length === 0}>
            {templates.length ? t('grid.import.noneOption') : t('grid.import.noSavedTemplates')}
          </SelectItem>
          {templates.map((tpl) => (
            <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!showSave ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowSave(true)}
          disabled={disabled}
          data-testid="import-template-save-btn"
        >
          {t('grid.import.saveCurrent')}
        </Button>
      ) : (
        <div className="flex items-center gap-1">
          <Input
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            placeholder={t('grid.import.templateName')}
            className="h-7 w-40 text-xs"
            data-testid="import-template-name-input"
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            onClick={() => { if (savingName.trim()) { onSaveAs(savingName.trim()); setSavingName(''); setShowSave(false); } }}
            disabled={!savingName.trim() || disabled}
            data-testid="import-template-confirm-save"
          >
            {t('grid.import.save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setShowSave(false); setSavingName(''); }}>
            {t('grid.import.cancel')}
          </Button>
        </div>
      )}
      {selectedId && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={t('grid.import.deleteTemplate')}
          data-testid="import-template-delete-btn"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

/** A saved mapping the target accepts: its write mode (insert when it names
 *  none) is one the host offers. Any other is listed disabled and never
 *  applied (objectui#12697). */
function savedMappingAccepted(m: SavedMapping, writeModes: readonly ImportWriteMode[]): boolean {
  return writeModes.includes(m.mode ?? 'insert');
}

/** Selector for a registered server-side import mapping (objectstack-ai/objectstack#2611).
 *  Picking one hands rename + transforms to the server; the manual column
 *  table is replaced by a read-only summary of the artifact. */
const SavedMappingBar: React.FC<{
  mappings: SavedMapping[];
  activeName: string | null;
  onSelect: (name: string) => void;
  onClear: () => void;
  /** The write modes the target accepts; a mapping writing in any other mode
   *  is listed disabled, its mode named, so it cannot be picked. */
  writeModes: readonly ImportWriteMode[];
}> = ({ mappings, activeName, onSelect, onClear, writeModes }) => {
  const { t } = useImportTranslation();
  if (mappings.length === 0) return null;
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2"
      data-testid="import-saved-mapping-bar"
    >
      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs font-medium text-muted-foreground">{t('grid.import.savedMapping')}</span>
      <Select value={activeName ?? '__none__'} onValueChange={(v) => (v === '__none__' ? onClear() : onSelect(v))}>
        <SelectTrigger className="h-7 w-56 text-xs" data-testid="import-saved-mapping-select">
          <SelectValue placeholder={t('grid.import.chooseSavedMapping')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t('grid.import.manualMapping')}</SelectItem>
          {mappings.map((m) => {
            const mode = m.mode ?? 'insert';
            const refused = !savedMappingAccepted(m, writeModes);
            return (
              <SelectItem
                key={m.name}
                value={m.name}
                disabled={refused}
                data-testid={`import-saved-mapping-option-${m.name}`}
              >
                {m.label || m.name}
                {refused && ` (${writeModeLabel(t, mode)})`}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};

/** Read-only summary of the chosen server mapping — source → target (transform)
 *  per fieldMapping entry. Names the transforms without re-running them. */
const SavedMappingSummary: React.FC<{ mapping: SavedMapping }> = ({ mapping }) => {
  const { t } = useImportTranslation();
  const rows = summarizeSavedMapping(mapping);
  return (
    <div data-testid="import-saved-mapping-summary">
      <p className="mb-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t('grid.import.savedMappingHint', { name: mapping.label || mapping.name })}</span>
      </p>
      <div className="max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('grid.import.csvColumn')}</TableHead>
              <TableHead>{t('grid.import.mapsTo')}</TableHead>
              <TableHead className="w-32 text-center">{t('grid.import.transform')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{r.source}</TableCell>
                <TableCell>{r.target}</TableCell>
                <TableCell className="text-center">
                  {r.transform
                    ? <Badge variant="outline" className="text-[10px] font-normal">{r.transform}</Badge>
                    : <EmptyValue />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

// Step 2: Column Mapping
const StepMapping: React.FC<{
  headers: string[];
  fields: ImportWizardProps['fields'];
  mapping: Record<number, string>;
  onMappingChange: (mapping: Record<number, string>) => void;
  inferredTypes: InferredType[];
  suggestions: ColumnSuggestion[];
  templates: ImportMappingTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string) => void;
  onSaveTemplate: (name: string) => void;
  onDeleteTemplate: () => void;
  savedMappings: SavedMapping[];
  activeMapping: SavedMapping | null;
  onSelectSavedMapping: (name: string) => void;
  onClearSavedMapping: () => void;
  writeModes: readonly ImportWriteMode[];
  /** Required fields with no column mapped — surfaced as an inline hint so the
   *  disabled Next button always explains itself. */
  missingRequired: ImportWizardProps['fields'];
  /** The id the hint's text carries: the disabled Next names it as its
   *  description (objectui#12303), so the reason is the control's, not only
   *  text that happens to sit above it. */
  missingRequiredHintId: string;
}> = ({ headers, fields, mapping, onMappingChange, inferredTypes, suggestions, templates, selectedTemplateId, onSelectTemplate, onSaveTemplate, onDeleteTemplate, savedMappings, activeMapping, onSelectSavedMapping, onClearSavedMapping, writeModes, missingRequired, missingRequiredHintId }) => {
  const { t } = useImportTranslation();
  const usedFields = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  const suggestionByCol = useMemo(() => {
    const m = new Map<number, ColumnSuggestion>();
    suggestions.forEach((s) => m.set(s.columnIndex, s));
    return m;
  }, [suggestions]);
  // How many columns were auto-matched (vs. the current, possibly-edited mapping).
  const autoMatchedCount = useMemo(() => {
    let n = 0;
    suggestionByCol.forEach((s, idx) => { if (s.fieldName && mapping[idx] === s.fieldName) n++; });
    return n;
  }, [suggestionByCol, mapping]);
  const handleChange = useCallback((colIdx: number, fieldName: string) => {
    const next = { ...mapping };
    if (fieldName === '__skip__') delete next[colIdx]; else next[colIdx] = fieldName;
    onMappingChange(next);
  }, [mapping, onMappingChange]);

  return (
    <div>
      <SavedMappingBar
        mappings={savedMappings}
        activeName={activeMapping?.name ?? null}
        onSelect={onSelectSavedMapping}
        onClear={onClearSavedMapping}
        writeModes={writeModes}
      />
      {activeMapping ? (
        <SavedMappingSummary mapping={activeMapping} />
      ) : (
      <>
      <TemplateBar
        templates={templates}
        selectedId={selectedTemplateId}
        onSelect={onSelectTemplate}
        onSaveAs={onSaveTemplate}
        onDelete={onDeleteTemplate}
        disabled={Object.keys(mapping).length === 0}
      />
      {autoMatchedCount > 0 && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="import-automatch-summary">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          {/* A NUMBER count: a count family (objectui#11445) plural-selects only on one. */}
          {t('grid.import.autoMatchedSummary', { count: autoMatchedCount })}
        </p>
      )}
      <div className="max-h-[420px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('grid.import.csvColumn')}</TableHead>
            <TableHead>{t('grid.import.mapsTo')}</TableHead>
            <TableHead className="w-24 text-center">{t('grid.import.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {headers.map((header, idx) => {
            const inferred = inferredTypes[idx] ?? 'text';
            const mappedField = mapping[idx] ? fields.find((f) => f.name === mapping[idx]) : undefined;
            const typeMismatch = !!mappedField && !isTypeCompatible(inferred, mappedField.type);
            const suggestion = suggestionByCol.get(idx);
            // Badge only while the user's choice still matches what we auto-suggested.
            const autoMatched = !!suggestion?.fieldName && mapping[idx] === suggestion.fieldName
              ? suggestion.confidence : null;
            return (
            <TableRow key={idx}>
              <TableCell className="font-medium">
                <div className="flex flex-col gap-0.5">
                  <span>{header}</span>
                  {inferred !== 'text' && (
                    <Badge variant="outline" className="w-fit text-[10px] font-normal text-muted-foreground" data-testid={`import-inferred-${idx}`}>
                      {t(`grid.import.type.${inferred}`)}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Select value={mapping[idx] ?? '__skip__'} onValueChange={(v) => handleChange(idx, v)}>
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder={t('grid.import.skipColumn')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__skip__">{t('grid.import.skip')}</SelectItem>
                    {fields.map((f) => (
                      <SelectItem key={f.name} value={f.name} disabled={usedFields.has(f.name) && mapping[idx] !== f.name}>
                        {f.label}{f.required ? ' *' : ''}{f.matchOnly ? ` ${t('grid.import.matchOnlyField')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {autoMatched && (
                  <p className={cn('mt-1 flex items-center gap-1 text-[11px]', CONFIDENCE_CLASS[autoMatched])} data-testid={`import-automatch-${idx}`}>
                    <CheckCircle2 className="h-3 w-3" /> {t('grid.import.autoMatched')} · {t(`grid.import.confidence.${autoMatched}`)}
                  </p>
                )}
                {typeMismatch && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600" data-testid={`import-type-warn-${idx}`}>
                    <AlertCircle className="h-3 w-3" /> {t('grid.import.typeMismatch', { type: t(`grid.import.type.${inferred}`) })}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-center">
                {mapping[idx]
                  ? <Badge variant="default" className="text-xs">{t('grid.import.mapped')}</Badge>
                  : <Badge variant="secondary" className="text-xs">{t('grid.import.skipped')}</Badge>}
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
      {missingRequired.length > 0 && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="import-missing-required"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span id={missingRequiredHintId}>
            {t('grid.import.missingRequiredHint', {
              fields: missingRequired
                .map((f) => (f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name))
                .join(', '),
            })}
          </span>
        </div>
      )}
      </>
      )}
    </div>
  );
};

/** How many rows the findings list names before it summarises the rest. */
const FINDINGS_ROW_LIMIT = 20;

/** A finding's field label and sentence, for a cell's tooltip and the findings list. */
type DescribeFinding = (finding: RowFinding) => { fieldLabel?: string; message: string };

// Step 3: Preview & Import (shows first 10 rows; every row's findings mark its cells)
const StepPreview: React.FC<{
  rows: string[][];
  /** The mapped columns, in column order. */
  mappedCols: MappedCol[];
  /** Inline corrections keyed by row index → csv column index → fixed value. */
  corrections: Record<number, Record<number, string>>;
  onCorrect: (rowIdx: number, csvIdx: number, value: string) => void;
  /** Every row's merged findings (client and server), keyed by 0-based row index. */
  findingsByRow: ReadonlyMap<number, RowFinding[]>;
  describe: DescribeFinding;
}> = ({ rows, mappedCols, corrections, onCorrect, findingsByRow, describe }) => {
  const { t } = useImportTranslation();
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT);

  /** Resolve the effective value for a cell, preferring an inline correction. */
  const effectiveValue = useCallback((rIdx: number, csvIdx: number) => {
    const fix = corrections[rIdx]?.[csvIdx];
    return fix !== undefined ? fix : (previewRows[rIdx]?.[csvIdx] ?? '');
  }, [corrections, previewRows]);

  // A cell is marked with the first finding on its column; a finding with no
  // column (a server finding on an unmapped field) marks the row only.
  const rowValidations = previewRows.map((_row, rIdx) => {
    const errs: Record<number, string> = {};
    for (const finding of findingsByRow.get(rIdx) ?? []) {
      if (finding.csvIdx !== undefined && errs[finding.csvIdx] === undefined) {
        errs[finding.csvIdx] = describe(finding).message;
      }
    }
    return errs;
  });

  // Every row with a finding, not only the previewed ones: the same rows the
  // import button leaves out of its count.
  const errorCount = findingsByRow.size;
  const correctedCount = Object.keys(corrections).length;

  return (
    <div className="max-h-[440px] overflow-auto">
      {(errorCount > 0 || correctedCount > 0) && (
        <p
          className="mb-2 flex items-center gap-2 text-xs"
          data-testid="import-preview-status"
        >
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {t('grid.import.rowsWithErrors', { count: errorCount })}
            </span>
          )}
          {correctedCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t('grid.import.rowsCorrected', { count: correctedCount })}
            </span>
          )}
          <span className="text-muted-foreground">{t('grid.import.clickToFix')}</span>
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            {mappedCols.map((col) => (
              <TableHead key={col.csvIdx} className="min-w-[140px] whitespace-nowrap">{col.field.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows.map((_row, rIdx) => {
            const errs = rowValidations[rIdx];
            const hasError = findingsByRow.has(rIdx);
            const wasCorrected = corrections[rIdx] !== undefined;
            return (
              <TableRow
                key={rIdx}
                className={cn(hasError && 'bg-destructive/5', !hasError && wasCorrected && 'bg-emerald-50 dark:bg-emerald-950/20')}
                data-testid={`import-preview-row-${rIdx}`}
              >
                <TableCell className="text-xs text-muted-foreground">{rIdx + 1}</TableCell>
                {mappedCols.map((col) => {
                  const value = effectiveValue(rIdx, col.csvIdx);
                  const cellErr = errs[col.csvIdx];
                  const wasFixed = corrections[rIdx]?.[col.csvIdx] !== undefined;
                  return (
                    <TableCell
                      key={col.csvIdx}
                      className={cn(cellErr && 'text-destructive', wasFixed && !cellErr && 'text-emerald-600')}
                      title={cellErr}
                    >
                      <Input
                        value={value}
                        onChange={(e) => onCorrect(rIdx, col.csvIdx, e.target.value)}
                        className={cn(
                          'h-7 px-1 text-xs',
                          cellErr && 'border-destructive',
                          wasFixed && !cellErr && 'border-emerald-500',
                        )}
                        data-testid={`import-preview-cell-${rIdx}-${col.csvIdx}`}
                        aria-invalid={cellErr ? 'true' : 'false'}
                        aria-label={`${col.field.label} for row ${rIdx + 1}`}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">{t('grid.import.showingRows', { shown: previewRows.length, total: rows.length })}</p>
    </div>
  );
};

/**
 * One list of what will keep rows out of the import: each row once, with every
 * finding on it, from the preview's own check and the server's dry run alike.
 * A dry-run refusal of the whole request heads the list without a row number.
 */
const ImportFindingsList: React.FC<{
  findingsByRow: ReadonlyMap<number, RowFinding[]>;
  requestFindings: readonly ImportRowResult[];
  describe: DescribeFinding;
}> = ({ findingsByRow, requestFindings, describe }) => {
  const { t } = useImportTranslation();
  if (findingsByRow.size === 0 && requestFindings.length === 0) return null;
  const rowsInOrder = [...findingsByRow.entries()].sort(([a], [b]) => a - b);
  const shown = rowsInOrder.slice(0, FINDINGS_ROW_LIMIT);
  const moreFindings = rowsInOrder
    .slice(FINDINGS_ROW_LIMIT)
    .reduce((n, [, findings]) => n + findings.length, 0);
  return (
    <div className="max-h-32 overflow-auto rounded-md border border-destructive/30 p-2 text-xs" data-testid="import-findings">
      <ul className="text-destructive">
        {requestFindings.map((result, i) => (
          <li key={`request-${i}`}>{describe({ source: 'server', result }).message}</li>
        ))}
        {shown.map(([rIdx, findings]) => (
          <li key={rIdx} data-testid={`import-findings-row-${rIdx}`}>
            {t('grid.import.errorRowPrefix', { row: rIdx + 1 })}
            {findings.map((finding, i) => {
              const { fieldLabel, message } = describe(finding);
              return (
                <span key={i}>
                  {i > 0 ? '; ' : ''}{fieldLabel ? `${fieldLabel}: ` : ''}{message}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
      {moreFindings > 0 && (
        <p className="text-muted-foreground">{t('grid.import.moreErrors', { count: moreFindings })}</p>
      )}
    </div>
  );
};

/** Options controlling how the server commits each row (insert/update/upsert
 *  + toggles). Rendered above the preview so the choices are visible before the
 *  import runs. */
const ImportOptions: React.FC<{
  fields: ImportWizardProps['fields'];
  mapping: Record<number, string>;
  writeMode: ImportWriteMode;
  onWriteMode: (m: ImportWriteMode) => void;
  /** The write modes the select offers (`ImportWizardProps.writeModes`). */
  writeModes: readonly ImportWriteMode[];
  matchFields: string[];
  onToggleMatchField: (name: string) => void;
  createMissingOptions: boolean;
  onCreateMissingOptions: (v: boolean) => void;
  skipBlankMatchKey: boolean;
  onSkipBlankMatchKey: (v: boolean) => void;
  showBackground: boolean;
  backgroundImport: boolean;
  onBackgroundImport: (v: boolean) => void;
}> = ({
  fields, mapping, writeMode, onWriteMode, writeModes, matchFields, onToggleMatchField,
  createMissingOptions, onCreateMissingOptions,
  skipBlankMatchKey, onSkipBlankMatchKey,
  showBackground, backgroundImport, onBackgroundImport,
}) => {
  const { t } = useImportTranslation();
  // Only fields that are actually mapped can serve as match keys.
  const mappedFieldNames = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  const matchable = useMemo(() => fields.filter((f) => mappedFieldNames.has(f.name)), [fields, mappedFieldNames]);
  const needsMatch = writeMode !== 'insert';

  return (
    <div className="mb-3 rounded-md border bg-muted/30 p-3" data-testid="import-options">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t('grid.import.options')}</p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t('grid.import.writeMode')}</Label>
          <Select value={writeMode} onValueChange={(v) => onWriteMode(v as ImportWriteMode)}>
            <SelectTrigger className="h-8 w-72 text-xs" data-testid="import-writemode-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {writeModes.map((m) => (
                <SelectItem key={m} value={m}>{writeModeLabel(t, m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsMatch && (
          <div className="flex flex-col gap-1.5" data-testid="import-matchfields">
            <Label className="text-xs">{t('grid.import.matchFields')}</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {matchable.length === 0 && (
                <span className="text-[11px] text-muted-foreground">{t('grid.import.matchFieldsPlaceholder')}</span>
              )}
              {matchable.map((f) => (
                <label key={f.name} className="flex items-center gap-1.5 text-xs" data-testid={`import-matchfield-${f.name}`}>
                  <Checkbox
                    checked={matchFields.includes(f.name)}
                    onCheckedChange={() => onToggleMatchField(f.name)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <p className={cn('text-[11px]', matchFields.length === 0 ? 'text-destructive' : 'text-muted-foreground')}>
              {matchFields.length === 0 ? t('grid.import.needMatchFields') : t('grid.import.matchFieldsHint')}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs" data-testid="import-opt-create-options">
            <Checkbox checked={createMissingOptions} onCheckedChange={(v) => onCreateMissingOptions(v === true)} />
            {t('grid.import.optCreateOptions')}
          </label>
          {needsMatch && (
            <label className="flex items-center gap-2 text-xs" data-testid="import-opt-skip-blank">
              <Checkbox checked={skipBlankMatchKey} onCheckedChange={(v) => onSkipBlankMatchKey(v === true)} />
              {t('grid.import.optSkipBlankKey')}
            </label>
          )}
          {showBackground && (
            <label className="flex items-center gap-2 text-xs" data-testid="import-opt-background">
              <Checkbox checked={backgroundImport} onCheckedChange={(v) => onBackgroundImport(v === true)} />
              <span>
                {t('grid.import.optBackground')}
                <span className="ml-1 text-[11px] text-muted-foreground">{t('grid.import.optBackgroundHint')}</span>
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
};

/** Colour intent for each import-job status badge. */
const IMPORT_JOB_STATUS_VARIANT: Record<ImportJobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
  cancelled: 'outline',
};

/** Format an ISO timestamp compactly for the history table; falls back to the
 *  raw string (or a dash) when it isn't a parseable date.
 *
 *  `locale` is the BCP-47 tag from `useDisplayLocale()`, and it is REQUIRED and
 *  non-optional on purpose (objectui#9327). Under a `locale?:` spelling a
 *  caller could drop the argument, still type-check, and render a *plausible
 *  date* rather than an error: an omitted tag means the MACHINE's locale, which
 *  is neither of this renderer's two locale channels. On a date that moves the
 *  FIELD ORDER — `04/03/2026` under `en-GB` is `3/4/2026` under `en-US` — and a
 *  history reader working out *which run was which* has no unit marker to catch
 *  the misreading. `iso` is therefore spelled `string | undefined` rather than
 *  `iso?:`: a required parameter cannot follow an optional one, and it is
 *  `locale` that must stay required.
 *
 *  ⛔ No `?? 'en'` backstop here. That would be a renderer-side default
 *  papering over an absent channel; `useDisplayLocale` already owns the last
 *  resort and always returns a concrete tag. */
function formatImportJobTime(iso: string | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale);
}

/**
 * Import-job history for one object: lists prior async jobs (status, counts,
 * time), lets the user cancel an in-flight job, and refresh. Degrades to an
 * empty state when the data source lacks `listImportJobs` (older adapter).
 */
const ImportHistoryPanel: React.FC<{
  objectName: string;
  dataSource: unknown;
  t: (key: string, vars?: Record<string, unknown>) => string;
}> = ({ objectName, dataSource, t }) => {
  // The one date/number locale resolver: tenant regional default -> active UI
  // language -> 'en'. Read unconditionally at component level, then handed to
  // `formatImportJobTime` as an argument — the helper stays a module-level pure
  // function rather than being inlined here just to reach the hook.
  const displayLocale = useDisplayLocale();
  const [jobs, setJobs] = useState<ImportJobSummaryInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ds = dataSource as Partial<DataSource> | undefined;
  const supported = typeof ds?.listImportJobs === 'function';
  const canUndo = typeof ds?.undoImportJob === 'function';

  const load = useCallback(async () => {
    if (typeof ds?.listImportJobs !== 'function') return;
    setLoading(true); setError(null);
    try {
      const list = await ds.listImportJobs({ object: objectName, limit: 50 });
      setJobs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [ds, objectName]);

  useEffect(() => { void load(); }, [load]);

  const handleCancel = useCallback(async (jobId: string) => {
    if (typeof ds?.cancelImportJob !== 'function') return;
    try { await ds.cancelImportJob(jobId); } catch { /* best-effort */ }
    void load();
  }, [ds, load]);

  // Logical rollback: delete created records + restore updated ones. Confirms
  // first (destructive + irreversible), then reloads so the row flips to
  // "reverted" and its Undo button disappears — or, after a partial undo, keeps
  // offering Undo for the rows that remain. What the undo left lives in its own
  // slot: the reload clears `error` as it starts, and would wipe it there.
  const [undoOutcome, setUndoOutcome] = useState<ImportUndoOutcome | null>(null);
  const reload = useCallback(() => { void load(); }, [load]);
  const { undoingId, undo: handleUndo } = useImportJobUndo(dataSource, objectName, t, setUndoOutcome, reload);

  if (!supported) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground" data-testid="import-history-unsupported">
        {t('grid.import.historyUnsupported')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="import-history">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('grid.import.historyHint')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="import-history-refresh">
          {loading ? t('grid.import.historyLoading') : t('grid.import.historyRefresh')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive" data-testid="import-history-error">{error}</p>}
      {undoOutcome && (
        <ImportUndoOutcomeNotice
          outcome={undoOutcome}
          t={t}
          errorTestId="import-history-undo-error"
          partialTestId="import-history-undo-partial"
        />
      )}
      {jobs && jobs.length === 0 && !loading && (
        <p className="p-6 text-center text-sm text-muted-foreground" data-testid="import-history-empty">
          {t('grid.import.historyEmpty')}
        </p>
      )}
      {jobs && jobs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('grid.import.historyColStatus')}</TableHead>
              <TableHead className="text-right">{t('grid.import.historyColRows')}</TableHead>
              <TableHead className="text-right">{t('grid.import.historyColResult')}</TableHead>
              <TableHead>{t('grid.import.historyColTime')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.jobId} data-testid={`import-history-row-${job.jobId}`}>
                <TableCell>
                  <Badge variant={IMPORT_JOB_STATUS_VARIANT[job.status]}>
                    {t(`grid.import.jobStatus.${job.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{job.processed}/{job.total}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  <span className="text-emerald-600">{t('grid.import.createdCount', { count: job.created })}</span>
                  {job.updated > 0 && <span className="text-muted-foreground"> · {t('grid.import.updatedCount', { count: job.updated })}</span>}
                  {job.skipped > 0 && <span className="text-muted-foreground"> · {t('grid.import.skippedCount', { count: job.skipped })}</span>}
                  {job.errors > 0 && <span className="text-destructive"> · {t('grid.import.errorCount', { count: job.errors })}</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatImportJobTime(job.completedAt ?? job.createdAt, displayLocale)}</TableCell>
                <TableCell className="text-right">
                  {isImportJobActive(job.status) && typeof ds?.cancelImportJob === 'function' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCancel(job.jobId)}
                      data-testid={`import-history-cancel-${job.jobId}`}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> {t('grid.import.cancelImport')}
                    </Button>
                  )}
                  {job.revertedAt && (
                    <span className="text-xs text-muted-foreground" data-testid={`import-history-reverted-${job.jobId}`}>
                      {t('grid.import.reverted')}
                    </span>
                  )}
                  {isImportJobUndoable(job, canUndo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleUndo(job.jobId)}
                      disabled={undoingId === job.jobId}
                      data-testid={`import-history-undo-${job.jobId}`}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                      {undoingId === job.jobId ? t('grid.import.undoing') : t('grid.import.undoImport')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};

// Main wizard component
export const ImportWizard: React.FC<ImportWizardProps> = ({
  objectName, objectLabel, fields, dataSource, onComplete, onCancel, open, onOpenChange, onErrorMode = 'skip',
  templateStorageKey, templateStorage, savedMappings, initialFile, extraOptionsContent, renderResultExtra,
  writeModes = ALL_WRITE_MODES,
}) => {
  if (writeModes.length === 0) {
    throw new Error('ImportWizard: `writeModes` must name at least one write mode the target accepts.');
  }
  // The mode the wizard starts in and returns to on reset: `insert` when the
  // target accepts it, else the first mode the host offers.
  const defaultWriteMode: ImportWriteMode = writeModes.includes('insert') ? 'insert' : writeModes[0];
  const { t } = useImportTranslation();
  const [step, setStep] = useState<WizardStep>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  // The rows came from a CSV file (a delimited-text file), so the request
  // travels as CSV text (assembleImportRequest, objectui#13315).
  const [csvFile, setCsvFile] = useState(false);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [corrections, setCorrections] = useState<Record<number, Record<number, string>>>({});
  // Import-job history view (swaps the wizard body for a list of prior jobs).
  const [showHistory, setShowHistory] = useState(false);
  // Async (large-file) import job — jobId + live processed/total, plus a ref the
  // poll loop reads so a mid-flight Cancel stops polling without a re-render race.
  const [jobId, setJobId] = useState<string | null>(null);
  const [asyncCounts, setAsyncCounts] = useState<{ processed: number; total: number } | null>(null);
  const cancelPollRef = React.useRef(false);
  // One import run at a time. The async paths capture this token, and a job
  // outcome is published only while it is unchanged: publishing moves it on, so
  // the poll loop and a user Cancel can never both publish (or call onComplete
  // twice), and an outcome landing after a newer run started is dropped.
  // Closing the wizard does NOT move it: a background job that finishes after
  // the dialog closed still reports through onComplete, so the host refreshes.
  const jobRunRef = React.useRef(0);
  // The final read of the job the result screen shows, for its Undo button.
  const [finishedJob, setFinishedJob] = useState<ImportJobProgressInfo | null>(null);
  // What the last Undo on the result screen left for the user to read.
  const [undoOutcome, setUndoOutcome] = useState<ImportUndoOutcome | null>(null);
  // Small-file server dry-run pre-check — validates the exact payload without
  // writing, so the summary/error list reflect real coercion outcomes.
  const [validating, setValidating] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<ImportRecordsResult | null>(null);
  // Write-mode + coercion options (drive the server-side /import request).
  const [writeMode, setWriteMode] = useState<ImportWriteMode>(defaultWriteMode);
  const [matchFields, setMatchFields] = useState<string[]>([]);
  const [createMissingOptions, setCreateMissingOptions] = useState(false);
  const [skipBlankMatchKey, setSkipBlankMatchKey] = useState(false);
  // Opt-in: route this import through a background job even when the row count
  // is under the async threshold. This is the only way to obtain an undoable
  // job for a small import — the sync path never captures undo state.
  const [backgroundImport, setBackgroundImport] = useState(false);
  const label = objectLabel ?? objectName;

  // Field api-name → human label, for friendlier dry-run error messages.
  const fieldLabelByName = useMemo(
    () => new Map(fields.map((f) => [f.name, f.label])),
    [fields],
  );
  // Field api-name → its source CSV column (first mapped match wins), so a
  // dry-run error can name the offending cell value without parsing the message.
  const csvIdxByField = useMemo(() => {
    const m = new Map<string, number>();
    for (const [idx, fieldName] of Object.entries(mapping)) {
      if (!m.has(fieldName)) m.set(fieldName, Number(idx));
    }
    return m;
  }, [mapping]);
  const dryRunCellValue = useCallback((row1Based: number, field?: string): string | undefined => {
    if (!field) return undefined;
    const csvIdx = csvIdxByField.get(field);
    if (csvIdx === undefined) return undefined;
    const rIdx = row1Based - 1;
    return corrections[rIdx]?.[csvIdx] ?? rows[rIdx]?.[csvIdx];
  }, [csvIdxByField, corrections, rows]);

  // The background-import toggle only makes sense when the data source can
  // actually run jobs (create + poll + fetch results). Mirrors the guard in
  // runAsyncImport so the checkbox never promises an unsupported path.
  const supportsImportJob = useMemo(() => {
    const ds = dataSource as Partial<DataSource> | undefined;
    return typeof ds?.createImportJob === 'function'
      && typeof ds?.getImportJobProgress === 'function'
      && typeof ds?.getImportJobResults === 'function';
  }, [dataSource]);

  // The import template is the SERVER's (objectui#9600): it lists only the
  // columns this caller can import, so the wizard builds none of its own. It is
  // offered when the data source can fetch it and the user can create records
  // of the object, the server's own gate on it (it answers 403 otherwise). Same
  // permission source as the toolbar that opens this wizard; with no
  // PermissionProvider mounted `can()` answers true and the server decides.
  // [objectui#12082] That is the `importTemplate` row of the affordance-to-grant
  // map (`resolveAffordance` in `@object-ui/core`) — the create grant, with no
  // CRUD-affordance bit: the template has its own endpoint, not the data door.
  const perms = usePermissions();
  const templateSource = dataSource as Partial<DataSource> | undefined;
  const fetchTemplate = templateSource?.downloadImportTemplate;
  const downloadTemplate = typeof fetchTemplate === 'function'
    && resolveAffordance('importTemplate', { objectName, perms }).allowed
    ? () => fetchTemplate.call(templateSource, objectName)
    : undefined;

  const toggleMatchField = useCallback((name: string) => {
    setMatchFields((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }, []);

  // Keep matchFields consistent with the current column mapping — drop any
  // match key whose column was unmapped so we never send a stale key.
  useEffect(() => {
    const mapped = new Set(Object.values(mapping));
    setMatchFields((prev) => {
      const next = prev.filter((n) => mapped.has(n));
      return next.length === prev.length ? prev : next;
    });
  }, [mapping]);

  // Template storage — resolved once; `null` opts out of persistence.
  const storage = useMemo<ImportTemplateStorage | null>(
    () => (templateStorage === undefined ? defaultTemplateStorage() : templateStorage),
    [templateStorage],
  );
  const storageKey = templateStorageKey ?? `objectui:import-templates:${objectName}`;
  const [templates, setTemplates] = useState<ImportMappingTemplate[]>(() => loadTemplates(storage, storageKey));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Re-hydrate templates if the storage backend or key changes.
  useEffect(() => { setTemplates(loadTemplates(storage, storageKey)); }, [storage, storageKey]);

  // ── Server-registered import mappings (objectstack-ai/objectstack#2611) ─────────────
  // The reusable, governed alternative to hand-building the column mapping.
  // Supplied via prop, or fetched from the adapter (feature-detected; a data
  // source without the method simply yields none, hiding the selector).
  const [fetchedMappings, setFetchedMappings] = useState<SavedMapping[]>([]);
  const [mappingName, setMappingName] = useState<string | null>(null);
  useEffect(() => {
    if (savedMappings) return; // caller-provided; don't fetch
    let alive = true;
    const list = (dataSource as { listImportMappings?: (o: string) => Promise<unknown[]> } | undefined)?.listImportMappings;
    if (typeof list !== 'function') { setFetchedMappings([]); return; }
    Promise.resolve(list.call(dataSource, objectName))
      .then((items) => { if (alive) setFetchedMappings((items ?? []).map(asSavedMapping).filter((m): m is SavedMapping => m !== null)); })
      .catch(() => { if (alive) setFetchedMappings([]); });
    return () => { alive = false; };
  }, [dataSource, objectName, savedMappings]);
  const availableMappings = savedMappings ?? fetchedMappings;
  const activeMapping = useMemo(
    () => availableMappings.find((m) => m.name === mappingName) ?? null,
    [availableMappings, mappingName],
  );

  // Select a registered mapping: the server owns rename + transforms, so we
  // set a read-only display mapping (for the preview grid) and reflect the
  // artifact's write semantics; submit sends source rows + mappingName, as CSV
  // text when the mapping declares `sourceFormat: 'csv'` or the source is a CSV
  // file the mapping does not declare `json` for (assembleImportRequest).
  const handleSelectSavedMapping = useCallback((name: string) => {
    const m = availableMappings.find((sm) => sm.name === name);
    if (!m) return;
    // A mapping writing in a mode the target refuses is never applied: the
    // selector lists it disabled with its mode named (objectui#12697), and no
    // path swaps its mode for another one behind the user's back.
    if (!savedMappingAccepted(m, writeModes)) return;
    setMappingName(name);
    setSelectedTemplateId(null);
    setMapping(savedMappingToDisplayIndexMap(m, headers));
    if (m.mode === 'update' || m.mode === 'upsert') setWriteMode(m.mode);
    if (Array.isArray(m.upsertKey)) setMatchFields(m.upsertKey.filter((f) => typeof f === 'string'));
    setDryRunResult(null);
  }, [availableMappings, headers, writeModes]);

  // objectui#13343 — when the object ships exactly ONE saved mapping the target
  // accepts, the mapping step opens with it applied, exactly as picking it from
  // the selector applies it; a user who never opens the menu would otherwise
  // import without its rename and transforms. With none or several there is
  // nothing to choose for the user, so nothing changes; a mapping listed
  // disabled (its mode refused, objectui#12697) does not count.
  // Decided ONCE per opening, the first time the mapping step has a non-empty
  // list: the ref, not any callback identity, holds that, so a re-fetched list
  // or a re-render never re-applies it over a user's switch to manual mapping.
  // `reset` re-arms it for the next opening.
  const preselectDecidedRef = React.useRef(false);
  useEffect(() => {
    if (preselectDecidedRef.current) return;
    if (step !== 'mapping' || headers.length === 0 || availableMappings.length === 0) return;
    preselectDecidedRef.current = true;
    if (mappingName !== null) return;
    const applicable = availableMappings.filter((m) => savedMappingAccepted(m, writeModes));
    if (applicable.length === 1) handleSelectSavedMapping(applicable[0].name);
  }, [step, headers, availableMappings, mappingName, writeModes, handleSelectSavedMapping]);

  // Return to hand-mapping: clear the named mapping and re-run auto-mapping.
  const handleClearSavedMapping = useCallback(() => {
    setMappingName(null);
    setWriteMode(defaultWriteMode);
    setMatchFields([]);
    setMapping(autoMapColumns(headers, fields, rows));
    setDryRunResult(null);
  }, [headers, fields, rows, defaultWriteMode]);

  const handleSelectTemplate = useCallback((id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setSelectedTemplateId(id);
    setMapping(applyTemplate(tpl, headers, fields));
  }, [templates, headers, fields]);

  const handleSaveTemplate = useCallback((name: string) => {
    const tpl: ImportMappingTemplate = {
      id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      mapping: mappingToTemplatePayload(headers, mapping),
      updatedAt: Date.now(),
    };
    const next = [...templates, tpl];
    setTemplates(next);
    setSelectedTemplateId(tpl.id);
    saveTemplates(storage, storageKey, next);
  }, [templates, headers, mapping, storage, storageKey]);

  const handleDeleteTemplate = useCallback(() => {
    if (!selectedTemplateId) return;
    const next = templates.filter((t) => t.id !== selectedTemplateId);
    setTemplates(next);
    setSelectedTemplateId(null);
    saveTemplates(storage, storageKey, next);
  }, [templates, selectedTemplateId, storage, storageKey]);

  const handleCorrect = useCallback((rowIdx: number, csvIdx: number, value: string) => {
    setCorrections((prev) => {
      const next = { ...prev };
      const row = { ...(next[rowIdx] ?? {}) };
      const original = rows[rowIdx]?.[csvIdx] ?? '';
      if (value === original) {
        delete row[csvIdx];
      } else {
        row[csvIdx] = value;
      }
      if (Object.keys(row).length === 0) delete next[rowIdx];
      else next[rowIdx] = row;
      return next;
    });
  }, [rows]);

  const missingRequired = useMemo(() => {
    const mapped = new Set(Object.values(mapping));
    return fields.filter((f) => f.required && !mapped.has(f.name));
  }, [fields, mapping]);
  // objectui#12303 — the "Can't continue" hint's id, so the Next it disables
  // is described by it. A saved mapping lets the server own the columns, so
  // Next is not held back by the missing fields then, and the hint is not shown.
  const missingRequiredHintId = React.useId();
  const nextHeldByRequired = !mappingName && missingRequired.length > 0;

  const handleFileLoaded = useCallback((h: string[], r: string[][], fromCsvFile: boolean) => {
    setHeaders(h); setRows(r); setCsvFile(fromCsvFile);
    setMapping(autoMapColumns(h, fields, r)); setCorrections({}); setStep('mapping');
  }, [fields]);

  // cloud#797 Excel→App: when opened with a pre-loaded file (from the AI build
  // panel's attachment), parse it once and jump straight to mapping — no
  // re-picking the file the user already attached. Consumed once per File
  // identity so reopening or a re-render doesn't re-parse or fight the user if
  // they navigate back to upload.
  const consumedInitialFileRef = React.useRef<File | null>(null);
  useEffect(() => {
    if (!open || !initialFile) return;
    if (consumedInitialFileRef.current === initialFile) return;
    consumedInitialFileRef.current = initialFile;
    let cancelled = false;
    void (async () => {
      try {
        const parsed = await parseSpreadsheetFile(initialFile);
        if (cancelled) return;
        if (parsed.length < 2) return; // needs a header + at least one row
        handleFileLoaded(parsed[0], parsed.slice(1), delimitedFileDelimiter(initialFile.name) !== null);
      } catch {
        // Parse failed — leave the wizard on the upload step so the user can
        // retry / pick a different file; the upload UI shows its own errors.
      }
    })();
    return () => { cancelled = true; };
  }, [open, initialFile, handleFileLoaded]);

  // Per-column type guesses, sampled from the loaded rows — drives mapping hints.
  const inferredTypes = useMemo<InferredType[]>(
    () => headers.map((_, idx) => inferColumnType(rows.map((r) => r[idx]))),
    [headers, rows],
  );

  // Airtable-style auto-mapping suggestions (with confidence), computed once per
  // file. Drives the "auto-matched" badges: a badge shows only while the user's
  // current mapping for a column still equals what we suggested.
  const suggestions = useMemo<ColumnSuggestion[]>(
    () => suggestColumnMappings(headers, fields, rows),
    [headers, fields, rows],
  );

  // ── Findings: what keeps a row out of the import (objectui#11814) ──────────
  // The mapped columns with their target field; a target no field declares is
  // left out. The preview checks every row, not just the previewed ones, since
  // the import button counts the rows nothing was found on.
  const mappedCols = useMemo<MappedCol[]>(
    () => Object.entries(mapping).flatMap(([idx, fieldName]) => {
      const field = fields.find((f) => f.name === fieldName);
      return field ? [{ csvIdx: Number(idx), field }] : [];
    }),
    [mapping, fields],
  );
  const checkedCols = useMemo(() => {
    const transformed = transformedSourceColumns(activeMapping, headers);
    return mappedCols.filter((col) => !transformed.has(col.csvIdx));
  }, [mappedCols, activeMapping, headers]);
  // A named mapping's request does not carry the setting (assembleImportRequest).
  const keepUnknownOptions = !mappingName && createMissingOptions;
  const requireValues = writeMode === 'insert';
  const uncorrectedFindings = useMemo<ClientFindings>(() => {
    const out: ClientFindings = new Map();
    const opts = { keepUnknownOptions, requireValues };
    rows.forEach((row, rIdx) => {
      const found = checkImportRow(row, checkedCols, opts);
      if (found.length > 0) out.set(rIdx, found);
    });
    return out;
  }, [rows, checkedCols, keepUnknownOptions, requireValues]);
  // Corrections touch previewed rows only, so only those are checked again.
  const clientFindings = useMemo<ClientFindings>(() => {
    const correctedRows = Object.entries(corrections);
    if (correctedRows.length === 0) return uncorrectedFindings;
    const out: ClientFindings = new Map(uncorrectedFindings);
    const opts = { keepUnknownOptions, requireValues };
    for (const [key, fixes] of correctedRows) {
      const rIdx = Number(key);
      const effective = [...(rows[rIdx] ?? [])];
      for (const [csvIdx, value] of Object.entries(fixes)) effective[Number(csvIdx)] = value;
      const found = checkImportRow(effective, checkedCols, opts);
      if (found.length > 0) out.set(rIdx, found);
      else out.delete(rIdx);
    }
    return out;
  }, [uncorrectedFindings, corrections, rows, checkedCols, keepUnknownOptions, requireValues]);
  const findings = useMemo(
    () => mergeRowFindings(clientFindings, dryRunResult, csvIdxByField, rows.length),
    [clientFindings, dryRunResult, csvIdxByField, rows.length],
  );
  const describeFinding: DescribeFinding = (finding) => {
    if (finding.source === 'server') {
      return formatDryRunError(finding.result, fieldLabelByName, dryRunCellValue(finding.result.row, finding.result.field), t);
    }
    // Named the way formatDryRunError names a server finding's field, so the
    // two halves of one row read alike.
    const fieldName = finding.field.name;
    const fieldLabel = fieldLabelByName.get(fieldName) ?? fieldName;
    return { fieldLabel, message: cellRefusalMessage(finding.refusal, finding.field, t) };
  };
  // The rows the import is expected to write: those with no finding at all.
  const importableRowCount = rows.length - findings.byRow.size;

  // Build raw, mapping-applied rows keyed by target field name (inline
  // corrections applied). Values stay RAW strings — the server coerces them to
  // storage values from field metadata, so booleans / dates / lookups / selects
  // are all handled uniformly server-side rather than guessed on the client.
  const buildRawRows = useCallback((): Array<Record<string, string>> => {
    const mappedCols = Object.entries(mapping).map(([idx, name]) => ({ csvIdx: Number(idx), field: name }));
    return rows.map((original, i) => {
      const fixes = corrections[i];
      const out: Record<string, string> = {};
      for (const col of mappedCols) {
        const v = fixes && fixes[col.csvIdx] !== undefined ? fixes[col.csvIdx] : (original[col.csvIdx] ?? '');
        out[col.field] = v;
      }
      return out;
    });
  }, [rows, mapping, corrections]);

  // Legacy fallback — per-row `create` with light client-side validation. Used
  // only when the adapter/client can't reach the server `/import` route.
  const legacyImport = useCallback(async () => {
    // Relation columns need the server to resolve display text into record
    // IDs; per-row `create` would store the raw text verbatim. Refuse up
    // front — corrupting relation data is worse than not importing.
    const refFields = mappedReferenceFields(mapping, fields);
    if (refFields.length > 0) {
      const importResult: ImportResult = {
        totalRows: rows.length,
        importedRows: 0,
        skippedRows: rows.length,
        errors: [{
          row: 0,
          field: refFields.map((f) => f.name).join(', '),
          message: t('grid.import.legacyReferenceBlocked', {
            fields: refFields.map((f) => f.label || f.name).join(', '),
          }),
        }],
      };
      setResult(importResult); setImporting(false); onComplete?.(importResult);
      return;
    }

    const errors: ImportResult['errors'] = [];
    let importedRows = 0, skippedRows = 0;
    const mappedCols = Object.entries(mapping).map(([idx, name]) => ({
      csvIdx: Number(idx), field: fields.find((f) => f.name === name)!,
    }));

    for (let i = 0; i < rows.length; i++) {
      const original = rows[i];
      const fixes = corrections[i];
      const effectiveRow = fixes
        ? original.map((v, idx) => (fixes[idx] !== undefined ? fixes[idx] : v))
        : original;

      // The per-row create runs no import coercion, so only the engine's own
      // option check applies: the one *Keep unknown option values* leaves.
      const { record, errors: rowErrors } = validateRow(effectiveRow, mappedCols, i + 1, true);
      if (rowErrors.length > 0) {
        skippedRows++;
        errors.push(...rowErrors);
        if (onErrorMode === 'stop') break;
      } else {
        try { if (dataSource?.create) await dataSource.create(objectName, record); importedRows++; }
        catch (err) {
          skippedRows++;
          const msg = err instanceof Error ? err.message : 'Failed to create record';
          errors.push({ row: i + 1, field: '', message: msg });
          if (onErrorMode === 'stop') break;
        }
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }
    // `degraded`: this per-row path ran because the server `/import` route was
    // unavailable — flag it so the completion screen tells the user the import
    // was downgraded (no server-side coercion) instead of reporting a clean win.
    const importResult: ImportResult = { totalRows: rows.length, importedRows, skippedRows, errors, degraded: true };
    setResult(importResult); setImporting(false); onComplete?.(importResult);
  }, [rows, mapping, fields, dataSource, objectName, onComplete, onErrorMode, corrections, t]);

  // Publish a finished job's outcome — the result screen, the job read behind
  // its Undo button, and onComplete — at most once per run (see jobRunRef). A
  // `cancelled` read is its own result; the other terminal states fetch the
  // per-row report. Resolves to whether this call published.
  const publishJobOutcome = useCallback(async (
    run: number,
    id: string,
    prog: ImportJobProgressInfo,
  ): Promise<boolean> => {
    const ds = dataSource as Partial<DataSource> | undefined;
    let importResult: ImportResult;
    if (prog.status === 'cancelled') {
      importResult = cancelledJobToImportResult(prog);
    } else {
      if (typeof ds?.getImportJobResults !== 'function') return false;
      importResult = jobResultToImportResult(await ds.getImportJobResults(id));
      if (prog.status === 'failed' && importResult.errors.length === 0) {
        importResult.errors.push({ row: 0, field: '', message: prog.error ?? 'Import failed' });
      }
    }
    if (jobRunRef.current !== run) return false;
    jobRunRef.current += 1;
    if (prog.status !== 'cancelled') setProgress(100);
    setFinishedJob(prog);
    setResult(importResult); setImporting(false); onComplete?.(importResult);
    return true;
  }, [dataSource, onComplete]);

  // Large-file path: hand the rows to a server-side background job and poll it
  // to completion. Returns `true` when the async path handled the import
  // (success / failure / cancel) and `false` when the data source can't run
  // jobs, signalling the caller to fall back to the synchronous route.
  const runAsyncImport = useCallback(async (request: ImportRequestOptions): Promise<boolean> => {
    const ds = dataSource as Partial<DataSource> | undefined;
    if (
      typeof ds?.createImportJob !== 'function' ||
      typeof ds?.getImportJobProgress !== 'function' ||
      typeof ds?.getImportJobResults !== 'function'
    ) {
      return false;
    }

    cancelPollRef.current = false;
    const run = jobRunRef.current;
    let created: CreateImportJobResult;
    try {
      created = await ds.createImportJob(objectName, request);
    } catch (err) {
      // [objectstack#3391] A 405 (object not open for import) must NOT fall back to the
      // sync route (which 405s too) — rethrow so handleImport surfaces the
      // dedicated message. Checked BEFORE the 404-based unsupported fallback.
      if (isImportNotAllowed(err)) throw err;
      if (isUnsupportedImportJob(err)) return false;
      throw err;
    }
    setJobId(created.jobId);
    setAsyncCounts({ processed: 0, total: created.total });

    let consecutivePollErrors = 0;
    let previous: ImportJobProgressInfo | null = null;
    // Poll until the job's outcome is final (or the user cancels, in which
    // case the cancel handler owns producing the result).
    for (;;) {
      if (cancelPollRef.current) return true;
      await new Promise((resolve) => setTimeout(resolve, IMPORT_JOB_POLL_INTERVAL));
      if (cancelPollRef.current) return true;

      let prog: ImportJobProgressInfo;
      try {
        prog = await ds.getImportJobProgress(created.jobId);
        consecutivePollErrors = 0;
      } catch (err) {
        if (cancelPollRef.current) return true;
        // Tolerate transient poll blips; give up only after several in a row so
        // a network hiccup doesn't abort an import that's still running server-side.
        if (++consecutivePollErrors >= 5) throw err;
        continue;
      }
      // A Cancel clicked while this read was in flight owns the outcome now.
      if (cancelPollRef.current) return true;

      setAsyncCounts({ processed: prog.processed, total: prog.total });
      setProgress(prog.percentComplete);

      const settled = isSettledJobRead(prog, previous);
      previous = prog;
      if (!settled) continue;

      await publishJobOutcome(run, created.jobId, prog);
      return true;
    }
  }, [dataSource, objectName, publishJobOutcome]);

  // Assemble the server import request from the current mapping + options.
  // `dryRun` reuses the exact same payload the real import will send, so the
  // pre-check validates precisely what would be written.
  // The format the chosen mapping declares, kept as a string so the callback
  // below keys on the declaration, not on a memoised object's identity.
  const mappingSourceFormat = activeMapping?.sourceFormat;
  const buildImportRequest = useCallback((dryRun = false): ImportRequestOptions =>
    assembleImportRequest(
      // A named mapping is applied server-side over SOURCE-header rows; the
      // hand-mapped, field-keyed rows are for the manual path only. Either
      // travels as CSV text for a CSV file (assembleImportRequest).
      mappingName ? buildSourceRows(headers, rows, corrections) : buildRawRows(),
      {
        writeMode, matchFields, createMissingOptions, skipBlankMatchKey, dryRun, csvFile,
        ...(mappingName ? { mappingName, mappingSourceFormat } : {}),
      },
    ),
  [buildRawRows, mappingName, mappingSourceFormat, headers, rows, corrections, writeMode, matchFields, createMissingOptions, skipBlankMatchKey, csvFile]);

  const handleImport = useCallback(async () => {
    setImporting(true); setProgress(0);
    cancelPollRef.current = false;
    jobRunRef.current += 1;
    setJobId(null); setAsyncCounts(null); setFinishedJob(null); setUndoOutcome(null);

    const request = buildImportRequest();

    // Route large files through a background job so they neither block the UI
    // nor trip the sync route's row ceiling. Small files can also opt into the
    // background path (the "background import" toggle) — that's the only way to
    // get an undoable job for a sub-threshold import. Any unsupported signal
    // (older adapter / client / server) falls through to the synchronous path.
    if (rows.length > ASYNC_IMPORT_THRESHOLD || backgroundImport) {
      try {
        const handled = await runAsyncImport(request);
        if (handled) return;
      } catch (err) {
        // [objectstack#3391] Object not open for import (405) → stop with the dedicated
        // message; never fall back to the sync route (it 405s too).
        if (isImportNotAllowed(err)) {
          const importResult: ImportResult = {
            totalRows: rows.length, importedRows: 0, skippedRows: rows.length,
            errors: [{ row: 0, field: '', message: t('grid.import.notAllowed') }],
          };
          setResult(importResult); setImporting(false); onComplete?.(importResult);
          return;
        }
        if (!isUnsupportedImportJob(err)) {
          const msg = err instanceof Error ? err.message : 'Import failed';
          const importResult: ImportResult = {
            totalRows: rows.length, importedRows: 0, skippedRows: rows.length,
            errors: [{ row: 0, field: '', message: msg }],
          };
          setResult(importResult); setImporting(false); onComplete?.(importResult);
          return;
        }
        // Unsupported — fall through to the synchronous path below.
      }
    }

    // Prefer the single-call server import: it coerces special values and
    // routes each row to insert / update / upsert. Fall back to the per-row
    // create loop only when the adapter can't speak `/import`.
    const serverImport = (dataSource as {
      importRecords?: (o: string, r: ImportRequestOptions) => Promise<ImportRecordsResult>;
    } | undefined)?.importRecords;

    if (typeof serverImport === 'function') {
      try {
        const res = await serverImport.call(dataSource, objectName, request);
        const importResult: ImportResult = {
          totalRows: res.total,
          importedRows: res.ok,
          skippedRows: res.skipped + res.errors,
          createdRows: res.created,
          updatedRows: res.updated,
          errors: res.results
            .filter((r) => !r.ok)
            .map((r) => ({ row: r.row, field: r.field ?? '', message: r.error ?? r.code ?? 'Import failed', code: r.code })),
          serverResult: res,
        };
        setProgress(100);
        setResult(importResult); setImporting(false); onComplete?.(importResult);
        return;
      } catch (err) {
        // [objectstack#3391] Object not open for import (405) → stop with the dedicated
        // message; never fall back to the legacy per-row loop (it 405s too).
        if (isImportNotAllowed(err)) {
          const importResult: ImportResult = {
            totalRows: rows.length, importedRows: 0, skippedRows: rows.length,
            errors: [{ row: 0, field: '', message: t('grid.import.notAllowed') }],
          };
          setResult(importResult); setImporting(false); onComplete?.(importResult);
          return;
        }
        if (!isUnsupportedImport(err)) {
          // A real server failure — surface it rather than silently retrying
          // via the legacy loop (which could double-import partial successes).
          const msg = err instanceof Error ? err.message : 'Import failed';
          const importResult: ImportResult = {
            totalRows: rows.length, importedRows: 0, skippedRows: rows.length,
            errors: [{ row: 0, field: '', message: msg }],
          };
          setResult(importResult); setImporting(false); onComplete?.(importResult);
          return;
        }
        // Unsupported — fall through to the legacy path below.
      }
    }

    await legacyImport();
  }, [
    dataSource, objectName, buildImportRequest, onComplete, rows.length, legacyImport, runAsyncImport,
    backgroundImport, t,
  ]);

  // Small-file server dry-run pre-check: validate + coerce every row without
  // persisting, so mapping / type / required errors are caught before import.
  // Large files skip this (they're validated row-by-row during the async job).
  const handleValidate = useCallback(async () => {
    const serverImport = (dataSource as {
      importRecords?: (o: string, r: ImportRequestOptions) => Promise<ImportRecordsResult>;
    } | undefined)?.importRecords;
    if (typeof serverImport !== 'function') return;
    setValidating(true);
    try {
      const res = await serverImport.call(dataSource, objectName, buildImportRequest(true));
      setDryRunResult(res);
    } catch (err) {
      // [objectstack#3391] Object not open for import (405) → surface the dedicated
      // message in the dry-run summary; checked before the /import unsupported
      // fall-back (which would silently hide the refusal).
      if (isImportNotAllowed(err)) {
        setDryRunResult({
          object: objectName, dryRun: true, writeMode, total: rows.length,
          ok: 0, errors: rows.length, created: 0, updated: 0, skipped: 0,
          results: [{ row: 0, ok: false, action: 'failed', error: t('grid.import.notAllowed') }],
        });
        return;
      }
      // Older adapter/client without /import — silently fall back to the
      // client-side cell validation that StepPreview already shows.
      if (!isUnsupportedImport(err)) {
        const msg = err instanceof Error ? err.message : 'Validation failed';
        setDryRunResult({
          object: objectName, dryRun: true, writeMode, total: rows.length,
          ok: 0, errors: rows.length, created: 0, updated: 0, skipped: 0,
          results: [{ row: 0, ok: false, action: 'failed', error: msg }],
        });
      }
    } finally {
      setValidating(false);
    }
  }, [dataSource, objectName, buildImportRequest, writeMode, rows.length, t]);

  // A prior dry-run becomes stale the moment the payload changes (mapping,
  // write-mode, options, or an inline cell correction) — drop it so the summary
  // never reflects data the user has since edited.
  useEffect(() => {
    setDryRunResult(null);
  }, [mapping, corrections, writeMode, matchFields, createMissingOptions, skipBlankMatchKey]);

  // User-initiated cancel of an in-flight async job. Stops the poll loop, asks
  // the server to cancel (best-effort), then reads the job back until its
  // outcome is final (bounded — see readSettledImportJob) and shows what the
  // server committed, with Undo when the job can be undone. When no read
  // settles within the bound, or the data source cannot read jobs, the result
  // says only that the import was cancelled: it shows no count it never read.
  const handleCancelImport = useCallback(async () => {
    cancelPollRef.current = true;
    const run = jobRunRef.current;
    const isStale = () => jobRunRef.current !== run;
    const id = jobId;
    const ds = dataSource as Partial<DataSource> | undefined;
    if (id && typeof ds?.cancelImportJob === 'function') {
      try { await ds.cancelImportJob(id); } catch { /* best-effort — the read below reports what happened */ }
    }
    const read = typeof ds?.getImportJobProgress === 'function' ? ds.getImportJobProgress.bind(ds) : undefined;
    if (id && read) {
      const settled = await readSettledImportJob(
        read, id, IMPORT_JOB_CANCEL_SETTLE_READS, IMPORT_JOB_POLL_INTERVAL, isStale,
      );
      try {
        if (settled && await publishJobOutcome(run, id, settled)) return;
      } catch { /* the per-row report failed — fall through to the bare cancelled result */ }
    }
    if (isStale()) return;
    jobRunRef.current += 1;
    const importResult: ImportResult = {
      totalRows: asyncCounts?.total ?? rows.length,
      importedRows: 0,
      skippedRows: 0,
      errors: [],
      cancelled: true,
    };
    setResult(importResult); setImporting(false);
  }, [jobId, dataSource, asyncCounts, rows.length, publishJobOutcome]);

  // Re-read the finished job after an Undo so its button gives way to "Undone"
  // (or, after a partial undo, keeps offering Undo for the rows that remain).
  // A read that lands after the wizard moved to another job is dropped.
  const rereadFinishedJob = useCallback(() => {
    const ds = dataSource as Partial<DataSource> | undefined;
    const id = finishedJob?.jobId;
    if (!id || typeof ds?.getImportJobProgress !== 'function') return;
    ds.getImportJobProgress(id).then(
      (job) => setFinishedJob((current) => (current?.jobId === job.jobId ? job : current)),
      () => { /* keep the last read */ },
    );
  }, [dataSource, finishedJob?.jobId]);
  const { undoingId, undo: undoFinishedJob } = useImportJobUndo(dataSource, objectName, t, setUndoOutcome, rereadFinishedJob);
  const canUndoJob = typeof (dataSource as Partial<DataSource> | undefined)?.undoImportJob === 'function';

  const reset = useCallback(() => {
    cancelPollRef.current = false;
    preselectDecidedRef.current = false;
    setFinishedJob(null); setUndoOutcome(null);
    setStep('upload'); setHeaders([]); setRows([]); setCsvFile(false); setMapping({}); setProgress(0); setResult(null);
    setCorrections({}); setSelectedTemplateId(null); setMappingName(null);
    setWriteMode(defaultWriteMode); setMatchFields([]);
    setCreateMissingOptions(false); setSkipBlankMatchKey(false);
    setJobId(null); setAsyncCounts(null);
    setValidating(false); setDryRunResult(null);
    setShowHistory(false);
  }, [defaultWriteMode]);

  /** Download a CSV of just the failed rows (original values + `_error`). */
  const handleDownloadFailed = useCallback(() => {
    if (!result || result.errors.length === 0) return;
    const errorsByRow = new Map<number, string>();
    for (const e of result.errors) {
      if (e.row < 1) continue; // top-level (row 0) errors have no source row
      const prefix = e.field ? `${e.field}: ` : '';
      const existing = errorsByRow.get(e.row);
      errorsByRow.set(e.row, existing ? `${existing}; ${prefix}${e.message}` : `${prefix}${e.message}`);
    }
    if (errorsByRow.size === 0) return;
    const csv = buildFailedRowsCsv(headers, rows, mapping, errorsByRow);
    try {
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${objectName}-import-errors.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { /* non-browser env */ }
  }, [result, headers, rows, mapping, objectName]);

  const handleClose = useCallback(() => { reset(); onOpenChange?.(false); onCancel?.(); }, [reset, onOpenChange, onCancel]);

  // The result screen's headline, icon and imported-count badge follow what
  // the import amounted to, not merely that it finished (objectui#13230).
  // `finishedJob` is published together with the result by the background
  // path and cleared by every new run, so it is the job behind this result.
  const resultOutcome: ImportOutcome = result ? importResultOutcome(result, finishedJob?.status) : 'success';
  const importedBadgeVariant = resultOutcome === 'failed' ? 'outline' : 'default';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange?.(v); }}>
      <DialogContent
        className={`flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-4xl ${DIALOG_VIEWPORT_GUTTER}`}
        // The wizard holds unsaved upload + mapping progress, so a stray click
        // must not close it. This blocks two accidental dismissals: (1) clicking
        // the gray overlay, and (2) clicking a Radix Select's dropdown flyout,
        // which is portalled to document.body and would otherwise read as an
        // "interact outside" the dialog. Users still close via the X, Cancel, or Esc.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> {t('grid.import.title', { object: label })}
            </DialogTitle>
            {step === 'upload' && !result && !importing
              && typeof (dataSource as Partial<DataSource> | undefined)?.listImportJobs === 'function' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory((v) => !v)}
                data-testid="import-history-toggle"
              >
                {showHistory ? t('grid.import.historyBack') : t('grid.import.history')}
              </Button>
            )}
          </div>
          {/* A finished import keeps `step === 'preview'`, so this subtitle used
              to read "Review data before importing." on the result screen
              (objectui#13124). The result screen's own headline is the dialog's
              description there instead (see `RESULT_HEADLINE_CLASS`), so the
              header carries none and exactly one description is mounted in
              every state: Radix wires `aria-describedby` only while one is. */}
          {(showHistory || !result) && (
            <DialogDescription>
              {showHistory
                ? t('grid.import.historyDescription')
                : step === 'upload' ? t('grid.import.uploadDescription')
                : step === 'mapping' ? t('grid.import.mappingDescription')
                : t('grid.import.previewDescription')}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step indicators */}
        {!showHistory && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {(['upload', 'mapping', 'preview'] as WizardStep[]).map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <ArrowRight className="h-3 w-3" />}
                <span className={cn('rounded-full px-3 py-1', step === s ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  {i + 1}. {s === 'upload' ? t('grid.import.stepUpload') : s === 'mapping' ? t('grid.import.stepMapping') : t('grid.import.stepPreview')}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
        {showHistory ? (
          <ImportHistoryPanel objectName={objectName} dataSource={dataSource} t={t} />
        ) : !result ? (
          <>
            {step === 'upload' && <StepUpload onFileLoaded={handleFileLoaded} downloadTemplate={downloadTemplate} objectName={objectName} objectLabel={label} />}
            {step === 'mapping' && (
              <StepMapping
                headers={headers}
                fields={fields}
                mapping={mapping}
                onMappingChange={setMapping}
                inferredTypes={inferredTypes}
                suggestions={suggestions}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={handleSelectTemplate}
                onSaveTemplate={handleSaveTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                savedMappings={availableMappings}
                activeMapping={activeMapping}
                onSelectSavedMapping={handleSelectSavedMapping}
                onClearSavedMapping={handleClearSavedMapping}
                writeModes={writeModes}
                missingRequired={missingRequired}
                missingRequiredHintId={missingRequiredHintId}
              />
            )}
            {step === 'preview' && (
              <>
                {extraOptionsContent && (
                  <div data-testid="import-extra-options">{extraOptionsContent}</div>
                )}
                {/* Write-mode/match options are owned by the artifact when a
                    named mapping is active; hide the manual panel. */}
                {!activeMapping && (
                <ImportOptions
                  fields={fields}
                  mapping={mapping}
                  writeMode={writeMode}
                  onWriteMode={setWriteMode}
                  writeModes={writeModes}
                  matchFields={matchFields}
                  onToggleMatchField={toggleMatchField}
                  createMissingOptions={createMissingOptions}
                  onCreateMissingOptions={setCreateMissingOptions}
                  skipBlankMatchKey={skipBlankMatchKey}
                  onSkipBlankMatchKey={setSkipBlankMatchKey}
                  showBackground={supportsImportJob && rows.length <= ASYNC_IMPORT_THRESHOLD}
                  backgroundImport={backgroundImport}
                  onBackgroundImport={setBackgroundImport}
                />
                )}
                {activeMapping && (
                  <div
                    className="mb-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
                    data-testid="import-saved-mapping-preview-note"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('grid.import.savedMappingPreviewNote', { name: activeMapping.label || activeMapping.name })}</span>
                  </div>
                )}
                <StepPreview
                  rows={rows}
                  mappedCols={mappedCols}
                  corrections={corrections}
                  onCorrect={handleCorrect}
                  findingsByRow={findings.byRow}
                  describe={describeFinding}
                />
                {rows.length > ASYNC_IMPORT_THRESHOLD && (
                  <div
                    className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
                    data-testid="import-large-sample-notice"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('grid.import.largeSampleNotice', { shown: PREVIEW_ROW_COUNT, total: rows.length })} {t('grid.import.asyncLargeHint')}</span>
                  </div>
                )}
                <ImportFindingsList
                  findingsByRow={findings.byRow}
                  requestFindings={findings.request}
                  describe={describeFinding}
                />
                {rows.length <= ASYNC_IMPORT_THRESHOLD
                  && typeof (dataSource as Partial<DataSource> | undefined)?.importRecords === 'function' && (
                  <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="import-validate">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{t('grid.import.validateHint')}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        disabled={validating}
                        data-testid="import-validate-btn"
                      >
                        {validating ? t('grid.import.validating') : t('grid.import.validate')}
                      </Button>
                    </div>
                    {dryRunResult && (
                      <div className="flex flex-col gap-1" data-testid="import-validate-result">
                        <p className={`text-xs font-medium ${dryRunResult.errors > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                          {dryRunResult.errors > 0
                            ? t('grid.import.validateFailed', { ok: dryRunResult.ok, errors: dryRunResult.errors })
                            : t('grid.import.validatePassed', { ok: dryRunResult.ok })}
                        </p>
                        {/* The failures themselves join the preview's findings in
                            the one per-row list above. */}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {importing && (
              <div className="flex flex-col items-center gap-2">
                <Progress value={progress} className="h-2 w-full" />
                <p className="text-center text-xs text-muted-foreground">
                  {jobId
                    ? asyncCounts
                      ? t('grid.import.asyncProcessing', { processed: asyncCounts.processed, total: asyncCounts.total, progress })
                      : t('grid.import.asyncQueued')
                    : t('grid.import.importing', { progress })}
                </p>
                {jobId && typeof (dataSource as Partial<DataSource> | undefined)?.cancelImportJob === 'function' && (
                  <Button variant="outline" size="sm" onClick={handleCancelImport} data-testid="import-cancel-async">
                    <X className="mr-1 h-4 w-4" /> {t('grid.import.cancelImport')}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4">
            {resultOutcome === 'cancelled' ? (
              <X className="h-10 w-10 text-muted-foreground" />
            ) : resultOutcome === 'failed' ? (
              <XCircle className="h-10 w-10 text-destructive" data-testid="import-result-failed-icon" />
            ) : resultOutcome === 'partial' ? (
              <AlertCircle className="h-10 w-10 text-muted-foreground" data-testid="import-result-partial-icon" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            )}
            <DialogDescription className={RESULT_HEADLINE_CLASS} data-testid="import-result-headline" data-outcome={resultOutcome}>
              {t(RESULT_HEADLINE_KEY[resultOutcome])}
            </DialogDescription>
            <div className="flex flex-wrap justify-center gap-2">
              {/* Prefer the finer created/updated breakdown when the server
                  reports it; otherwise fall back to a single "imported" count.
                  A cancelled result without the breakdown is one whose job the
                  wizard could not read back, so it shows no count at all. */}
              {result.createdRows !== undefined || result.updatedRows !== undefined ? (
                <>
                  {(result.createdRows ?? 0) > 0 && <Badge variant="default">{t('grid.import.createdCount', { count: result.createdRows })}</Badge>}
                  {(result.updatedRows ?? 0) > 0 && <Badge variant="default">{t('grid.import.updatedCount', { count: result.updatedRows })}</Badge>}
                  {(result.createdRows ?? 0) === 0 && (result.updatedRows ?? 0) === 0 && (
                    <Badge variant={importedBadgeVariant}>{t('grid.import.imported', { count: result.importedRows })}</Badge>
                  )}
                </>
              ) : !result.cancelled && (
                <Badge variant={importedBadgeVariant}>{t('grid.import.imported', { count: result.importedRows })}</Badge>
              )}
              {result.skippedRows > 0 && <Badge variant="destructive">{t('grid.import.skippedCount', { count: result.skippedRows })}</Badge>}
            </div>
            {/* A cancelled job keeps the rows it committed; offer the same
                Undo the History list does, once the job reads undoable. */}
            {result.cancelled && finishedJob?.revertedAt && (
              <span className="text-xs text-muted-foreground" data-testid="import-cancelled-reverted">
                {t('grid.import.reverted')}
              </span>
            )}
            {result.cancelled && finishedJob && isImportJobUndoable(finishedJob, canUndoJob) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void undoFinishedJob(finishedJob.jobId)}
                disabled={undoingId === finishedJob.jobId}
                data-testid="import-cancelled-undo"
              >
                <Undo2 className="mr-1 h-4 w-4" />
                {undoingId === finishedJob.jobId ? t('grid.import.undoing') : t('grid.import.undoImport')}
              </Button>
            )}
            {result.cancelled && undoOutcome && (
              <ImportUndoOutcomeNotice
                outcome={undoOutcome}
                t={t}
                errorTestId="import-cancelled-undo-error"
                partialTestId="import-cancelled-undo-partial"
              />
            )}
            {result.degraded && !result.cancelled && (
              <div
                className="flex w-full items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                data-testid="import-degraded-notice"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('grid.import.legacyFallbackNotice')}</span>
              </div>
            )}
            {renderResultExtra && (
              <div className="w-full" data-testid="import-result-extra">{renderResultExtra(result)}</div>
            )}
            {result.errors.length > 0 && (
              <>
                <div className="max-h-32 w-full overflow-auto rounded border p-2 text-xs">
                  {result.errors.slice(0, 10).map((err, i) => {
                    // Localize the same way the dry-run panel does (drive off
                    // `code`, resolve the api-name to its label, drop the raw
                    // server text for known codes) so the completion screen and
                    // the pre-check read identically (objectstack#3566).
                    const { fieldLabel, message } = formatDryRunError(
                      { field: err.field, error: err.message, code: err.code },
                      fieldLabelByName,
                      dryRunCellValue(err.row, err.field),
                      t,
                    );
                    return (
                      <p key={i} className="text-destructive">
                        {err.row >= 1 ? t('grid.import.errorRowPrefix', { row: err.row }) : ''}
                        {fieldLabel ? `${fieldLabel}: ` : ''}{message}
                      </p>
                    );
                  })}
                  {result.errors.length > 10 && <p className="text-muted-foreground">{t('grid.import.moreErrors', { count: result.errors.length - 10 })}</p>}
                </div>
                {result.errors.some((e) => e.row >= 1) && (
                  <Button variant="outline" size="sm" onClick={handleDownloadFailed} data-testid="import-download-failed">
                    <Download className="mr-1 h-4 w-4" /> {t('grid.import.downloadFailed')}
                  </Button>
                )}
              </>
            )}
            {result.resultsTruncated && (
              <p className="text-center text-xs text-muted-foreground">
                {t('grid.import.resultsTruncated', { count: result.errors.length, total: result.skippedRows })}
              </p>
            )}
          </div>
        )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {showHistory ? (
            <Button variant="outline" onClick={() => setShowHistory(false)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> {t('grid.import.historyBack')}
            </Button>
          ) : result ? (
            <Button onClick={handleClose} data-testid="import-close-btn">{t('grid.import.close')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose} disabled={importing}><X className="mr-1 h-4 w-4" /> {t('grid.import.cancel')}</Button>
              {(step === 'mapping' || step === 'preview') && (
                <Button variant="outline" onClick={() => setStep(step === 'mapping' ? 'upload' : 'mapping')} disabled={importing}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> {t('grid.import.back')}
                </Button>
              )}
              {step === 'mapping' && (() => {
                const next = (
                  <Button
                    onClick={() => setStep('preview')}
                    disabled={mappingName ? false : (Object.keys(mapping).length === 0 || missingRequired.length > 0)}
                    aria-describedby={nextHeldByRequired ? missingRequiredHintId : undefined}
                    data-testid="import-next-btn"
                  >
                    {t('grid.import.next')} <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                );
                if (!nextHeldByRequired) return next;
                // objectui#12303 — the record page's Archive pattern
                // (`DeclaredActionsBar`, objectui#11811): a natively disabled
                // button takes no focus, so the wrapping span is the tab stop,
                // and it and the button are described by the visible "Can't
                // continue" text above, which says exactly why.
                return (
                  <span
                    tabIndex={0}
                    aria-describedby={missingRequiredHintId}
                    data-disabled-reason=""
                    className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {next}
                  </span>
                );
              })()}
              {step === 'preview' && (
                <Button
                  onClick={handleImport}
                  disabled={importing || (!mappingName && writeMode !== 'insert' && matchFields.length === 0)}
                  data-testid="import-run-btn"
                >
                  {importing ? t('grid.import.importingProgress') : t('grid.import.importNRows', { count: importableRowCount })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
