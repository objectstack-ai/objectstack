// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';
import { BaseResponseSchema } from './contract.zod';

/**
 * Data Export & Import Protocol
 *
 * Defines schemas for streaming data export, import validation,
 * template-based field mapping, and scheduled export jobs.
 *
 * Industry alignment: Salesforce Data Export, Airtable CSV Export,
 * Dynamics 365 Data Management.
 *
 * Base path: /api/v1/data/{object}/export
 */

// ==========================================
// 1. Export Format & Configuration
// ==========================================

/**
 * Export Format Enum
 * Supported file formats for data export.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ExportFormat = z.enum([
  'csv',
  'json',
  'jsonl',
  'xlsx',
  'parquet',
]);
export type ExportFormat = z.input<typeof ExportFormat>;

/**
 * Export Job Status
 */
export const ExportJobStatus = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);
export type ExportJobStatus = z.input<typeof ExportJobStatus>;

// ==========================================
// 2. Export Job Request / Response
// ==========================================

/**
 * Create Export Job Request
 * Initiates an asynchronous streaming export.
 *
 * @example POST /api/v1/data/account/export
 * { format: 'csv', fields: ['name', 'email', 'status'], filter: { status: 'active' }, limit: 10000 }
 */
export const CreateExportJobRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to export'),
  format: ExportFormat.default('csv').describe('Export file format'),
  fields: z.array(z.string()).optional()
    .describe('Specific fields to include (omit for all fields)'),
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Filter criteria for records to export'),
  sort: z.array(z.object({
    field: z.string().describe('Field name to sort by'),
    direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction'),
  })).optional().describe('Sort order for exported records'),
  limit: z.number().int().min(1).optional()
    .describe('Maximum number of records to export'),
  includeHeaders: z.boolean().default(true)
    .describe('Include header row (CSV/XLSX)'),
  encoding: z.string().default('utf-8')
    .describe('Character encoding for the export file'),
  templateId: z.string().optional()
    .describe('Export template ID for predefined field mappings'),
}));
export type CreateExportJobRequest = z.input<typeof CreateExportJobRequestSchema>;
/** Post-parse shape of {@link CreateExportJobRequest} — defaults applied, transforms run (ADR-0122). */
export type CreateExportJobRequestParsed = z.infer<typeof CreateExportJobRequestSchema>;

/**
 * Export Job Response
 * Returns the created export job with tracking info.
 */
export const CreateExportJobResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    jobId: z.string().describe('Export job ID'),
    status: ExportJobStatus.describe('Initial job status'),
    estimatedRecords: z.number().int().optional().describe('Estimated total records'),
    createdAt: z.string().datetime().describe('Job creation timestamp'),
  }),
}));
export type CreateExportJobResponse = z.input<typeof CreateExportJobResponseSchema>;
/** Post-parse shape of {@link CreateExportJobResponse} — defaults applied, transforms run (ADR-0122). */
export type CreateExportJobResponseParsed = z.infer<typeof CreateExportJobResponseSchema>;

/**
 * Export Job Progress
 * Tracks the progress of an active export job.
 *
 * @example GET /api/v1/data/export/:jobId
 */
export const ExportJobProgressSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    jobId: z.string().describe('Export job ID'),
    status: ExportJobStatus.describe('Current job status'),
    format: ExportFormat.describe('Export format'),
    totalRecords: z.number().int().optional().describe('Total records to export'),
    processedRecords: z.number().int().describe('Records processed so far'),
    percentComplete: z.number().min(0).max(100).describe('Export progress percentage'),
    fileSize: z.number().int().optional().describe('Current file size in bytes'),
    downloadUrl: z.string().optional()
      .describe('Presigned download URL (available when status is "completed")'),
    downloadExpiresAt: z.string().datetime().optional()
      .describe('Download URL expiration timestamp'),
    error: z.object({
      code: z.string().describe('Error code'),
      message: z.string().describe('Error message'),
    }).optional().describe('Error details if job failed'),
    startedAt: z.string().datetime().optional().describe('Processing start timestamp'),
    completedAt: z.string().datetime().optional().describe('Completion timestamp'),
  }),
}));
export type ExportJobProgress = z.input<typeof ExportJobProgressSchema>;
/** Post-parse shape of {@link ExportJobProgress} — defaults applied, transforms run (ADR-0122). */
export type ExportJobProgressParsed = z.infer<typeof ExportJobProgressSchema>;

// ==========================================
// 3. Import Validation & Deduplication
// ==========================================

/**
 * Import Validation Mode
 */
export const ImportValidationMode = z.enum([
  'strict',      // Reject entire import on any validation error
  'lenient',     // Skip invalid records, import valid ones
  'dry_run',     // Validate all records without persisting
]);
export type ImportValidationMode = z.input<typeof ImportValidationMode>;

/**
 * Deduplication Strategy
 * How to handle duplicate records during import.
 */
export const DeduplicationStrategy = z.enum([
  'skip',           // Skip duplicates (keep existing)
  'update',         // Update existing with import data
  'create_new',     // Create new record even if duplicate
  'fail',           // Fail the import if duplicates found
]);
export type DeduplicationStrategy = z.input<typeof DeduplicationStrategy>;

/**
 * Import Validation Config Schema
 * Configuration for validating and deduplicating imported data.
 *
 * @example
 * {
 *   mode: 'lenient',
 *   deduplication: { strategy: 'update', matchFields: ['email', 'external_id'] },
 *   maxErrors: 50,
 *   trimWhitespace: true,
 * }
 */
export const ImportValidationConfigSchema = lazySchema(() => z.object({
  mode: ImportValidationMode.default('strict')
    .describe('Validation mode for the import'),
  deduplication: z.object({
    strategy: DeduplicationStrategy.default('skip')
      .describe('How to handle duplicate records'),
    matchFields: z.array(z.string()).min(1)
      .describe('Fields used to identify duplicates (e.g., "email", "external_id")'),
  }).optional().describe('Deduplication configuration'),
  maxErrors: z.number().int().min(1).default(100)
    .describe('Maximum validation errors before aborting'),
  trimWhitespace: z.boolean().default(true)
    .describe('Trim leading/trailing whitespace from string fields'),
  dateFormat: z.string().optional()
    .describe('Expected date format in import data (e.g., "YYYY-MM-DD")'),
  nullValues: z.array(z.string()).optional()
    .describe('Strings to treat as null (e.g., ["", "N/A", "null"])'),
}));
export type ImportValidationConfig = z.input<typeof ImportValidationConfigSchema>;
/** Post-parse shape of {@link ImportValidationConfig} — defaults applied, transforms run (ADR-0122). */
export type ImportValidationConfigParsed = z.infer<typeof ImportValidationConfigSchema>;

/**
 * Import Validation Result Schema
 * Summary of the import validation pass.
 */
export const ImportValidationResultSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    totalRecords: z.number().int().describe('Total records in import file'),
    validRecords: z.number().int().describe('Records that passed validation'),
    invalidRecords: z.number().int().describe('Records that failed validation'),
    duplicateRecords: z.number().int().describe('Duplicate records detected'),
    errors: z.array(z.object({
      row: z.number().int().describe('Row number in the import file'),
      field: z.string().optional().describe('Field that failed validation'),
      code: z.string().describe('Validation error code'),
      message: z.string().describe('Validation error message'),
    })).describe('List of validation errors'),
    preview: z.array(z.record(z.string(), z.unknown())).optional()
      .describe('Preview of first N valid records (for dry_run mode)'),
  }),
}));
export type ImportValidationResult = z.input<typeof ImportValidationResultSchema>;
/** Post-parse shape of {@link ImportValidationResult} — defaults applied, transforms run (ADR-0122). */
export type ImportValidationResultParsed = z.infer<typeof ImportValidationResultSchema>;

// ==========================================
// 4. Export/Import Template
// ==========================================

/**
 * Field Mapping Entry Schema
 * Maps a source field to a target field with optional transformation.
 */
export const FieldMappingEntrySchema = lazySchema(() => z.object({
  sourceField: z.string().describe('Field name in the source data (import) or object (export)'),
  targetField: z.string().describe('Field name in the target object (import) or file column (export)'),
  targetLabel: z.string().optional().describe('Display label for the target column (export)'),
  transform: z.enum(['none', 'uppercase', 'lowercase', 'trim', 'date_format', 'lookup'])
    .default('none')
    .describe('Transformation to apply during mapping'),
  defaultValue: z.unknown().optional()
    .describe('Default value if source field is null/empty'),
  required: z.boolean().default(false)
    .describe('Whether this field is required (import validation)'),
}));
export type FieldMappingEntry = z.input<typeof FieldMappingEntrySchema>;
/** Post-parse shape of {@link FieldMappingEntry} — defaults applied, transforms run (ADR-0122). */
export type FieldMappingEntryParsed = z.infer<typeof FieldMappingEntrySchema>;

/**
 * Export/Import Template Schema
 * Reusable template for predefined field mappings.
 *
 * @example
 * {
 *   name: 'account_export_v1',
 *   label: 'Account Export (Standard)',
 *   object: 'account',
 *   direction: 'export',
 *   mappings: [
 *     { sourceField: 'name', targetField: 'Company Name' },
 *     { sourceField: 'email', targetField: 'Email', transform: 'lowercase' },
 *   ],
 * }
 */
export const ExportImportTemplateSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Template ID (generated on save)'),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Template machine name (snake_case)'),
  label: z.string().describe('Human-readable template label'),
  description: z.string().optional().describe('Template description'),
  object: z.string().describe('Target object name'),
  direction: z.enum(['import', 'export', 'bidirectional'])
    .describe('Template direction'),
  format: ExportFormat.optional().describe('Default file format for this template'),
  mappings: z.array(FieldMappingEntrySchema).min(1)
    .describe('Field mapping entries'),
  createdAt: z.string().datetime().optional().describe('Template creation timestamp'),
  updatedAt: z.string().datetime().optional().describe('Last update timestamp'),
  createdBy: z.string().optional().describe('User who created the template'),
}));
export type ExportImportTemplate = z.input<typeof ExportImportTemplateSchema>;
/** Post-parse shape of {@link ExportImportTemplate} — defaults applied, transforms run (ADR-0122). */
export type ExportImportTemplateParsed = z.infer<typeof ExportImportTemplateSchema>;

// ==========================================
// 4b. Import Request / Result (POST /data/:object/import)
// ==========================================

/**
 * Import Write Mode
 * How each incoming row is committed against existing data.
 */
export const ImportWriteMode = z.enum([
  'insert',   // Always create a new record (default; ignores matchFields)
  'update',   // Update an existing record matched by matchFields; skip if none
  'upsert',   // Update when matched by matchFields, else create
]);
export type ImportWriteMode = z.input<typeof ImportWriteMode>;

/**
 * Field Mapping (import)
 * Either a compact `{ sourceColumn: targetField }` record, or the richer
 * `FieldMappingEntry[]` form (per-column transform + default + required).
 */
export const ImportMappingSchema = lazySchema(() => z.union([
  z.record(z.string(), z.string()),
  z.array(FieldMappingEntrySchema),
]));
export type ImportMapping = z.input<typeof ImportMappingSchema>;
/** Post-parse shape of {@link ImportMapping} — defaults applied, transforms run (ADR-0122). */
export type ImportMappingParsed = z.infer<typeof ImportMappingSchema>;

/**
 * Import Request Schema
 * Body for `POST /api/v1/data/:object/import`.
 *
 * The server coerces every cell to its storage value using the object's field
 * metadata (booleans, numbers, dates→ISO, select label→code, lookup name→id),
 * so the client sends raw spreadsheet values plus an optional column mapping.
 *
 * @example
 * {
 *   format: 'csv', csv: 'Name,Owner,Stage\nAcme,jane@x.com,Won',
 *   mapping: { Name: 'name', Owner: 'owner', Stage: 'stage' },
 *   writeMode: 'upsert', matchFields: ['name'], runAutomations: false,
 * }
 */
export const ImportRequestSchema = lazySchema(() => z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional()
    .describe('Payload shape: csv text, a rows[] array, or a base64 xlsx (inferred when omitted)'),
  csv: z.string().optional().describe('CSV text (when format = csv)'),
  rows: z.array(z.record(z.string(), z.unknown())).optional()
    .describe('Row objects (when format = json)'),
  xlsxBase64: z.string().optional()
    .describe('Base64-encoded .xlsx workbook bytes (when format = xlsx); parsed server-side'),
  sheet: z.union([z.string(), z.number().int()]).optional()
    .describe('Worksheet name or 1-based index to read (xlsx; defaults to the first sheet)'),
  mapping: ImportMappingSchema.optional()
    .describe('Source column → target field mapping'),
  dryRun: z.boolean().default(false)
    .describe(
      'Validate + coerce every row without persisting. The verdict is the engine\'s own write-path ' +
      'validation, with one boundary an author should know: a preview runs NO automations. Hooks never ' +
      'fire in a dry run (#6037) — a preview that executed user-authored side effects (mail, outbound ' +
      'calls, writes to other objects) would be the retired `validateOnly` defect in a new spelling. So a ' +
      'dry run with `runAutomations: true` can report `required` for a field a `beforeInsert` hook would ' +
      'populate during the real import; for hook-derived fields the real write is authoritative.',
    ),
  writeMode: ImportWriteMode.default('insert')
    .describe('insert / update / upsert semantics'),
  matchFields: z.array(z.string()).optional()
    .describe('Fields that identify an existing record (required for update/upsert)'),
  runAutomations: z.boolean().default(true)
    .describe(
      'Fire triggers/hooks for each imported row. ON by default, and opting out must be ' +
      'explicit: automations always ran on import historically (the engine ignored this flag ' +
      'until #2922), so a caller that wants a silent bulk load sends `runAutomations: false` — ' +
      'omitting the key runs them. This matches platform convention (Salesforce fires triggers ' +
      'on import by default). One boundary: a `dryRun` preview runs NO automations whatever ' +
      'this flag says (#6037).',
    ),
  treatAsHistorical: z.boolean().default(false)
    .describe('Import as established historical facts. Two effects, both off by default so a normal import is unchanged: (1) skip the state_machine rule so mid-lifecycle rows (e.g. already-closed tickets, closed_won deals) are not rejected by initialStates (#3479); and (2) preserve the original audit timeline — keep the supplied created_at / updated_at / updated_by and author-declared business readonly fields (e.g. closed_at, resolved_by) instead of stamping-now / stripping them (#3493). Undoing a historical import mirrors (2): the captured pre-import values are restored verbatim rather than re-stamped (#3556).'),
  trimWhitespace: z.boolean().default(true)
    .describe('Trim leading/trailing whitespace from string cells'),
  nullValues: z.array(z.string()).optional()
    .describe('Strings treated as null/blank (besides empty string)'),
  createMissingOptions: z.boolean().default(false)
    .describe('Keep unmatched select values instead of failing the row'),
  skipBlankMatchKey: z.boolean().default(false)
    .describe('Skip rows whose matchFields are blank (default: upsert creates them, update skips them)'),
}));
export type ImportRequest = z.input<typeof ImportRequestSchema>;
/** Post-parse shape of {@link ImportRequest} — defaults applied, transforms run (ADR-0122). */
export type ImportRequestParsed = z.infer<typeof ImportRequestSchema>;

/**
 * Import Row Result
 * Per-row outcome so a UI can render an import report and offer a failed-row
 * re-export.
 */
export const ImportRowResultSchema = lazySchema(() => z.object({
  row: z.number().int().describe('1-based row number in the source data'),
  ok: z.boolean().describe('Whether the row succeeded'),
  action: z.enum(['created', 'updated', 'skipped', 'failed'])
    .describe('What happened to the row'),
  id: z.string().optional().describe('Record id (created/updated rows)'),
  field: z.string().optional().describe('Field that caused a coercion/validation error'),
  code: z.string().optional().describe('Error code (failed rows)'),
  error: z.string().optional().describe('Human-readable error message (failed rows)'),
}));
export type ImportRowResult = z.input<typeof ImportRowResultSchema>;

/**
 * Import Response Schema
 * Aggregate summary + per-row results returned by the import route.
 */
export const ImportResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Target object name'),
  dryRun: z.boolean().describe('Whether this was a validate-only pass'),
  writeMode: ImportWriteMode.describe('Write mode used'),
  total: z.number().int().describe('Rows processed'),
  ok: z.number().int().describe('Rows that succeeded'),
  errors: z.number().int().describe('Rows that failed'),
  created: z.number().int().describe('Rows that created a new record'),
  updated: z.number().int().describe('Rows that updated an existing record'),
  skipped: z.number().int().describe('Rows skipped (no match in update mode, etc.)'),
  results: z.array(ImportRowResultSchema).describe('Per-row outcomes'),
}));
export type ImportResponse = z.input<typeof ImportResponseSchema>;

// ==========================================
// 4b. Asynchronous Import Jobs
// ==========================================

/**
 * Hard ceiling on rows accepted by a single async import job. The client sends
 * the whole payload in one request (rows[] or a base64 xlsx); this caps memory
 * and worker time. Files larger than this must be split client-side.
 */
export const IMPORT_JOB_MAX_ROWS = 50_000;

/**
 * Import Job Status. Mirrors {@link ExportJobStatus} but with the terminal
 * states the import worker actually uses (`succeeded` rather than `completed`).
 */
export const ImportJobStatus = z.enum([
  'pending',    // Row persisted, worker not yet started
  'running',    // Worker streaming through the batch
  'succeeded',  // Finished (rows may still have per-row errors)
  'failed',     // Aborted on a fatal error
  'cancelled',  // Cancelled by the caller before completion
]);
export type ImportJobStatus = z.input<typeof ImportJobStatus>;

/**
 * Create Import Job Request — body for `POST /api/v1/data/:object/import/jobs`.
 * Identical to the synchronous {@link ImportRequestSchema} payload; the only
 * difference is the endpoint processes it in the background and streams
 * progress instead of blocking until done.
 */
export const CreateImportJobRequestSchema = ImportRequestSchema;
export type CreateImportJobRequest = z.input<typeof CreateImportJobRequestSchema>;
/** Post-parse shape of {@link CreateImportJobRequest} — defaults applied, transforms run (ADR-0122). */
export type CreateImportJobRequestParsed = z.infer<typeof CreateImportJobRequestSchema>;

/**
 * Create Import Job Response — the freshly-created job's id + initial status.
 */
export const CreateImportJobResponseSchema = lazySchema(() => z.object({
  jobId: z.string().describe('Import job id — poll progress/results with this'),
  object: z.string().describe('Target object name'),
  status: ImportJobStatus.describe('Initial job status (usually "pending")'),
  total: z.number().int().describe('Rows accepted for processing'),
  createdAt: z.string().describe('Job creation timestamp (ISO 8601)'),
}));
export type CreateImportJobResponse = z.input<typeof CreateImportJobResponseSchema>;

/**
 * Import Job Progress — the live counters a client polls while the job runs.
 */
export const ImportJobProgressSchema = lazySchema(() => z.object({
  jobId: z.string().describe('Import job id'),
  object: z.string().describe('Target object name'),
  status: ImportJobStatus.describe('Current job status'),
  dryRun: z.boolean().describe('Whether this is a validate-only pass'),
  writeMode: ImportWriteMode.describe('Write mode used'),
  total: z.number().int().describe('Total rows to process'),
  processed: z.number().int().describe('Rows processed so far'),
  created: z.number().int().describe('Rows that created a new record'),
  updated: z.number().int().describe('Rows that updated an existing record'),
  skipped: z.number().int().describe('Rows skipped'),
  errors: z.number().int().describe('Rows that failed'),
  percentComplete: z.number().min(0).max(100).describe('processed / total as a percentage'),
  undoable: z.boolean().describe('Whether this job can still be logically rolled back (undo log captured, terminal state, not yet reverted)'),
  revertedAt: z.string().optional().describe('When the job was undone / rolled back (ISO 8601)'),
  error: z.string().optional().describe('Fatal error message (when status = failed)'),
  startedAt: z.string().optional().describe('Processing start timestamp (ISO 8601)'),
  completedAt: z.string().optional().describe('Completion timestamp (ISO 8601)'),
  createdAt: z.string().describe('Job creation timestamp (ISO 8601)'),
}));
export type ImportJobProgress = z.input<typeof ImportJobProgressSchema>;

/**
 * Import Job Results — the progress payload plus a capped sample of per-row
 * outcomes (failures first) so a UI can render the report / failed-row export.
 */
export const ImportJobResultsSchema = lazySchema(() => ImportJobProgressSchema.extend({
  results: z.array(ImportRowResultSchema).describe('Capped sample of per-row outcomes (failures first)'),
  resultsTruncated: z.boolean().describe('Whether `results` is a capped sample of a larger set'),
}));
export type ImportJobResults = z.input<typeof ImportJobResultsSchema>;

/**
 * List Import Jobs Request — query params for the history endpoint.
 */
export const ListImportJobsRequestSchema = lazySchema(() => z.object({
  object: z.string().optional().describe('Filter to one target object'),
  status: ImportJobStatus.optional().describe('Filter by job status'),
  limit: z.number().int().min(1).max(200).default(50).describe('Max rows to return'),
  offset: z.number().int().min(0).default(0).describe('Pagination offset'),
}));
export type ListImportJobsRequest = z.input<typeof ListImportJobsRequestSchema>;
/** Post-parse shape of {@link ListImportJobsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListImportJobsRequestParsed = z.infer<typeof ListImportJobsRequestSchema>;

/** One row in the import-job history list. */
export const ImportJobSummarySchema = lazySchema(() => z.object({
  jobId: z.string().describe('Import job id'),
  object: z.string().describe('Target object name'),
  status: ImportJobStatus.describe('Job status'),
  total: z.number().int().describe('Total rows'),
  processed: z.number().int().describe('Rows processed'),
  created: z.number().int().describe('Rows created'),
  updated: z.number().int().describe('Rows updated'),
  skipped: z.number().int().describe('Rows skipped'),
  errors: z.number().int().describe('Rows failed'),
  createdAt: z.string().describe('Job creation timestamp (ISO 8601)'),
  completedAt: z.string().optional().describe('Completion timestamp (ISO 8601)'),
  undoable: z.boolean().describe('Whether this job can still be logically rolled back'),
  revertedAt: z.string().optional().describe('When the job was undone / rolled back (ISO 8601)'),
}));
export type ImportJobSummary = z.input<typeof ImportJobSummarySchema>;

/** List Import Jobs Response — newest first. */
export const ListImportJobsResponseSchema = lazySchema(() => z.object({
  jobs: z.array(ImportJobSummarySchema).describe('Import jobs, newest first'),
}));
export type ListImportJobsResponse = z.input<typeof ListImportJobsResponseSchema>;

/**
 * Undo Import Job Response — the outcome of a logical rollback: created records
 * deleted, updated records restored to their pre-import field values.
 */
export const UndoImportJobResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the undo completed'),
  jobId: z.string().describe('Import job id'),
  object: z.string().describe('Target object name'),
  deleted: z.number().int().describe('Created records deleted'),
  restored: z.number().int().describe('Updated records restored to pre-import values'),
  failed: z.number().int().describe('Reversal operations that failed'),
}));
export type UndoImportJobResponse = z.input<typeof UndoImportJobResponseSchema>;

// ==========================================
// 5. Scheduled Export Jobs
// ==========================================

/**
 * Scheduled Export Schema
 * Defines a recurring data export job.
 *
 * @example
 * {
 *   name: 'weekly_account_export',
 *   object: 'account',
 *   format: 'csv',
 *   schedule: { cronExpression: '0 6 * * MON', timezone: 'America/New_York' },
 *   delivery: { method: 'email', recipients: ['admin@example.com'] },
 * }
 */
export const ScheduledExportSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Scheduled export ID'),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Schedule name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  object: z.string().describe('Object name to export'),
  format: ExportFormat.default('csv').describe('Export file format'),
  fields: z.array(z.string()).optional().describe('Fields to include'),
  filter: z.record(z.string(), z.unknown()).optional().describe('Record filter criteria'),
  templateId: z.string().optional().describe('Export template ID for field mappings'),
  schedule: z.object({
    cronExpression: CronExpressionInputSchema.describe('Cron expression for schedule'),
    timezone: z.string().default('UTC').describe('IANA timezone'),
  }).describe('Schedule timing configuration'),
  delivery: z.object({
    method: z.enum(['email', 'storage', 'webhook'])
      .describe('How to deliver the export file'),
    recipients: z.array(z.string()).optional()
      .describe('Email recipients (for email delivery)'),
    storagePath: z.string().optional()
      .describe('Storage path (for storage delivery)'),
    webhookUrl: z.string().optional()
      .describe('Webhook URL (for webhook delivery)'),
  }).describe('Export delivery configuration'),
  enabled: z.boolean().default(true).describe('Whether the scheduled export is active'),
  lastRunAt: z.string().datetime().optional().describe('Last execution timestamp'),
  nextRunAt: z.string().datetime().optional().describe('Next scheduled execution'),
  createdAt: z.string().datetime().optional().describe('Creation timestamp'),
  createdBy: z.string().optional().describe('User who created the schedule'),
}));
export type ScheduledExport = z.input<typeof ScheduledExportSchema>;
/** Post-parse shape of {@link ScheduledExport} — defaults applied, transforms run (ADR-0122). */
export type ScheduledExportParsed = z.infer<typeof ScheduledExportSchema>;

// ==========================================
// 6. Get Export Job Download
// ==========================================

/**
 * Get Export Job Download Request
 * Retrieves a presigned download link for a completed export job.
 *
 * @example GET /api/v1/data/export/:jobId/download
 */
export const GetExportJobDownloadRequestSchema = lazySchema(() => z.object({
  jobId: z.string().describe('Export job ID'),
}));
export type GetExportJobDownloadRequest = z.input<typeof GetExportJobDownloadRequestSchema>;

/**
 * Get Export Job Download Response
 * Returns the presigned download URL and metadata.
 */
export const GetExportJobDownloadResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    jobId: z.string().describe('Export job ID'),
    downloadUrl: z.string().describe('Presigned download URL'),
    fileName: z.string().describe('Suggested file name'),
    fileSize: z.number().int().describe('File size in bytes'),
    format: ExportFormat.describe('Export file format'),
    expiresAt: z.string().datetime().describe('Download URL expiration timestamp'),
    checksum: z.string().optional().describe('File checksum (SHA-256)'),
  }),
}));
export type GetExportJobDownloadResponse = z.input<typeof GetExportJobDownloadResponseSchema>;
/** Post-parse shape of {@link GetExportJobDownloadResponse} — defaults applied, transforms run (ADR-0122). */
export type GetExportJobDownloadResponseParsed = z.infer<typeof GetExportJobDownloadResponseSchema>;

// ==========================================
// 7. List Export Jobs
// ==========================================

/**
 * List Export Jobs Request
 * Retrieves a paginated list of historical export jobs.
 *
 * @example GET /api/v1/data/export?object=account&status=completed&limit=20
 */
export const ListExportJobsRequestSchema = lazySchema(() => z.object({
  object: z.string().optional().describe('Filter by object name'),
  status: ExportJobStatus.optional().describe('Filter by job status'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum number of jobs to return'),
  cursor: z.string().optional()
    .describe('Pagination cursor from a previous response'),
}));
export type ListExportJobsRequest = z.input<typeof ListExportJobsRequestSchema>;
/** Post-parse shape of {@link ListExportJobsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListExportJobsRequestParsed = z.infer<typeof ListExportJobsRequestSchema>;

/**
 * Export Job Summary
 * Compact representation of an export job for list views.
 */
export const ExportJobSummarySchema = lazySchema(() => z.object({
  jobId: z.string().describe('Export job ID'),
  object: z.string().describe('Object name that was exported'),
  status: ExportJobStatus.describe('Current job status'),
  format: ExportFormat.describe('Export file format'),
  totalRecords: z.number().int().optional().describe('Total records exported'),
  fileSize: z.number().int().optional().describe('File size in bytes'),
  createdAt: z.string().datetime().describe('Job creation timestamp'),
  completedAt: z.string().datetime().optional().describe('Completion timestamp'),
  createdBy: z.string().optional().describe('User who initiated the export'),
}));
export type ExportJobSummary = z.input<typeof ExportJobSummarySchema>;

/**
 * List Export Jobs Response
 * Paginated list of export jobs with cursor-based pagination.
 */
export const ListExportJobsResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    jobs: z.array(ExportJobSummarySchema).describe('List of export jobs'),
    nextCursor: z.string().optional().describe('Cursor for the next page'),
    hasMore: z.boolean().describe('Whether more jobs are available'),
  }),
}));
export type ListExportJobsResponse = z.input<typeof ListExportJobsResponseSchema>;
/** Post-parse shape of {@link ListExportJobsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListExportJobsResponseParsed = z.infer<typeof ListExportJobsResponseSchema>;

// ==========================================
// 8. Schedule Export Request/Response
// ==========================================

/**
 * Schedule Export Request
 * Creates a new scheduled (recurring) export job.
 *
 * @example POST /api/v1/data/export/schedules
 */
export const ScheduleExportRequestSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Schedule name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  object: z.string().describe('Object name to export'),
  format: ExportFormat.default('csv').describe('Export file format'),
  fields: z.array(z.string()).optional().describe('Fields to include'),
  filter: z.record(z.string(), z.unknown()).optional().describe('Record filter criteria'),
  templateId: z.string().optional().describe('Export template ID for field mappings'),
  schedule: z.object({
    cronExpression: CronExpressionInputSchema.describe('Cron expression for schedule'),
    timezone: z.string().default('UTC').describe('IANA timezone'),
  }).describe('Schedule timing configuration'),
  delivery: z.object({
    method: z.enum(['email', 'storage', 'webhook'])
      .describe('How to deliver the export file'),
    recipients: z.array(z.string()).optional()
      .describe('Email recipients (for email delivery)'),
    storagePath: z.string().optional()
      .describe('Storage path (for storage delivery)'),
    webhookUrl: z.string().optional()
      .describe('Webhook URL (for webhook delivery)'),
  }).describe('Export delivery configuration'),
}));
export type ScheduleExportRequest = z.input<typeof ScheduleExportRequestSchema>;
/** Post-parse shape of {@link ScheduleExportRequest} — defaults applied, transforms run (ADR-0122). */
export type ScheduleExportRequestParsed = z.infer<typeof ScheduleExportRequestSchema>;

/**
 * Schedule Export Response
 * Returns the created scheduled export with generated ID and next run info.
 */
export const ScheduleExportResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    id: z.string().describe('Scheduled export ID'),
    name: z.string().describe('Schedule name'),
    enabled: z.boolean().describe('Whether the schedule is active'),
    nextRunAt: z.string().datetime().optional().describe('Next scheduled execution'),
    createdAt: z.string().datetime().describe('Creation timestamp'),
  }),
}));
export type ScheduleExportResponse = z.input<typeof ScheduleExportResponseSchema>;
/** Post-parse shape of {@link ScheduleExportResponse} — defaults applied, transforms run (ADR-0122). */
export type ScheduleExportResponseParsed = z.infer<typeof ScheduleExportResponseSchema>;

// ==========================================
// 9. Export API Contracts
// ==========================================

/**
 * Export API Contract Registry
 * Used for generating SDKs, documentation, and route registration.
 */
export const ExportApiContracts = {
  createExportJob: {
    method: 'POST' as const,
    path: '/api/v1/data/:object/export',
    input: CreateExportJobRequestSchema,
    output: CreateExportJobResponseSchema,
  },
  getExportJobProgress: {
    method: 'GET' as const,
    path: '/api/v1/data/export/:jobId',
    input: z.object({ jobId: z.string() }),
    output: ExportJobProgressSchema,
  },
  getExportJobDownload: {
    method: 'GET' as const,
    path: '/api/v1/data/export/:jobId/download',
    input: GetExportJobDownloadRequestSchema,
    output: GetExportJobDownloadResponseSchema,
  },
  listExportJobs: {
    method: 'GET' as const,
    path: '/api/v1/data/export',
    input: ListExportJobsRequestSchema,
    output: ListExportJobsResponseSchema,
  },
  scheduleExport: {
    method: 'POST' as const,
    path: '/api/v1/data/export/schedules',
    input: ScheduleExportRequestSchema,
    output: ScheduleExportResponseSchema,
  },
  cancelExportJob: {
    method: 'POST' as const,
    path: '/api/v1/data/export/:jobId/cancel',
    input: z.object({ jobId: z.string() }),
    output: BaseResponseSchema,
  },
};

// ==========================================
// 10. Import API Contracts (async jobs)
// ==========================================

/**
 * Import Job API Contract Registry — the async counterpart to the synchronous
 * `POST /api/v1/data/:object/import`. The wizard submits a large payload once,
 * then polls progress/results and lists history.
 */
export const ImportJobApiContracts = {
  createImportJob: {
    method: 'POST' as const,
    path: '/api/v1/data/:object/import/jobs',
    input: CreateImportJobRequestSchema,
    output: CreateImportJobResponseSchema,
  },
  getImportJobProgress: {
    method: 'GET' as const,
    path: '/api/v1/data/import/jobs/:jobId',
    input: z.object({ jobId: z.string() }),
    output: ImportJobProgressSchema,
  },
  getImportJobResults: {
    method: 'GET' as const,
    path: '/api/v1/data/import/jobs/:jobId/results',
    input: z.object({ jobId: z.string() }),
    output: ImportJobResultsSchema,
  },
  listImportJobs: {
    method: 'GET' as const,
    path: '/api/v1/data/import/jobs',
    input: ListImportJobsRequestSchema,
    output: ListImportJobsResponseSchema,
  },
  cancelImportJob: {
    method: 'POST' as const,
    path: '/api/v1/data/import/jobs/:jobId/cancel',
    input: z.object({ jobId: z.string() }),
    output: BaseResponseSchema,
  },
  undoImportJob: {
    method: 'POST' as const,
    path: '/api/v1/data/import/jobs/:jobId/undo',
    input: z.object({ jobId: z.string() }),
    output: UndoImportJobResponseSchema,
  },
};
