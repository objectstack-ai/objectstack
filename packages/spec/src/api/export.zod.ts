// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { ValidateDataIssueSchema } from './protocol.zod';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';
import { ColumnApplyOnSchema } from '../data/column-apply-on.zod';

/**
 * Data Export & Import Protocol
 *
 * Defines the export file formats, import validation, template-based field
 * mapping, and the asynchronous import-job contracts.
 *
 * Industry alignment: Salesforce Data Export, Airtable CSV Export,
 * Dynamics 365 Data Management.
 *
 * The export the platform serves is the synchronous streaming door
 * `GET /api/v1/data/:object/export`, which answers the file itself as CSV,
 * JSON or XLSX. The asynchronous export-job API that used to be
 * declared here (export jobs, their progress / download / list shapes,
 * scheduled exports and `ExportApiContracts`) was never served by any route and
 * was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove); a recurring
 * export is a `Job` whose handler you write.
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

// ==========================================
// 2. Export Job API — RETIRED (#17158)
// ==========================================

/*
 * The export-job API family was DELETED here in @objectstack/spec 17 (ADR-0049
 * enforce-or-remove; maintainer ruling A on #17158, landing route A). It
 * declared an asynchronous export API — `ExportJobStatus`,
 * `CreateExportJobRequest` / `CreateExportJobResponse`, `ExportJobProgress`,
 * `ScheduledExport`, `GetExportJobDownloadRequest` / `GetExportJobDownloadResponse`,
 * `ListExportJobsRequest` / `ExportJobSummary` / `ListExportJobsResponse`,
 * `ScheduleExportRequest` / `ScheduleExportResponse` and the
 * `ExportApiContracts` route map (formerly sections 2 and 5–9 of this file) —
 * that nothing served: no route under `/api/v1/data/export`, no `POST` on
 * `/api/v1/data/:object/export`, no provider for the `IExportService` contract
 * that retired with it, and no reader in any repo. Each def is registered in
 * `RETIRED_DEFS_BY_MAJOR[18]`; the D3 semantic entry
 * `export-job-family-retired` carries the prescription.
 *
 * The export that IS served is the synchronous streaming door
 * `GET /api/v1/data/:object/export` (`@objectstack/rest`), which answers CSV,
 * JSON or XLSX (its own `format` read, not `ExportFormat` above). A recurring
 * export is a `Job` whose handler you write (`Job.schedule.expression`,
 * `system/job.zod.ts`).
 */

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
  applyOn: ColumnApplyOnSchema.default('always')
    .describe(
      'When an import writes this column. `always` (default) writes it on every row the import ' +
      'creates or updates. `create` writes it only when the row is created: an `upsert` that ' +
      'matches an existing record leaves that record\'s value as it is, and an `update` import ' +
      'never writes it, so re-running one upsert refreshes the `always` columns without ' +
      'reverting state written since the first run. A create-only column is still read for ' +
      'matching: the match key a row was found by stays in that row\'s update.',
    ),
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
 *   writeMode: 'upsert', matchFields: ['name'],
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
  mappingName: z.string().optional()
    .describe(
      'Name of a registered `mapping` metadata artifact to apply; the server resolves it '
      + '(org-scoped rows first, then env-wide) and projects columns through it. Mutually '
      + 'exclusive with an inline `mapping` — supplying both is refused (400 CONFLICTING_MAPPING).',
    ),
  dryRun: z.boolean().default(false)
    .describe(
      'Validate + coerce every row without persisting. The verdict is the engine\'s own write-path ' +
      'validation, with one boundary an author should know: a preview runs NO automations. Hooks never ' +
      'fire in a dry run — a preview that executed user-authored side effects (mail, outbound ' +
      'calls, writes to other objects) would be the retired `validateOnly` defect in a new spelling. So a ' +
      'dry run with `runAutomations: true` can report `required` for a field a `beforeInsert` hook would ' +
      'populate during the real import; for hook-derived fields the real write is authoritative.',
    ),
  writeMode: ImportWriteMode.default('insert')
    .describe('insert / update / upsert semantics'),
  matchFields: z.union([
    z.array(z.string()),
    z.array(z.array(z.string()).min(1)).min(1),
  ]).optional()
    .describe(
      'Fields that identify an existing record (required for update/upsert). Either one key set ' +
      '(`[\'email\']`), or an ordered list of key sets (`[[\'credit_code\'], [\'country\', ' +
      '\'registration_no\']]`) for a sheet whose rows are identified in different ways: each row ' +
      'is matched by the first set whose fields are all non-blank on that row, and only by that ' +
      'set. A row blank on every set fails with `BLANK_MATCH_KEY` instead of being created or ' +
      'skipped, so `skipBlankMatchKey` cannot be combined with key sets. A set that matches more ' +
      'than one record fails the row with `AMBIGUOUS_MATCH`, as one key set does. Rows of one ' +
      'import that carry the same key (the key set each row is matched by, with its cell values ' +
      'as coerced, so an option label and its value are one key) all fail with ' +
      '`DUPLICATE_MATCH_KEY`, naming every row that carries it, and none of them is written, on a ' +
      'dry run as on the import: keep one row per key.',
    ),
  runAutomations: z.boolean().default(true)
    .describe(
      'Fire triggers/hooks for each imported row. ON by default, and opting out must be ' +
      'explicit: automations always ran on import historically (the engine ignored this flag ' +
      'until this flag was honoured), so omitting the key runs them. This matches platform ' +
      'convention (Salesforce fires triggers on import by default). Only the system principal (an ' +
      'in-process caller such as a seed or migration job) may send `runAutomations: false`, because ' +
      'it takes the object\'s triggers and metadata-bound hooks, its approvals and record freezes ' +
      'among them, off every row: the import doors refuse it from every other caller, every ' +
      'signed-in user and administrator included, with `403 PERMISSION_DENIED` before any row is ' +
      'read. One boundary: a `dryRun` preview runs NO automations whatever this flag says.',
    ),
  treatAsHistorical: z.boolean().default(false)
    .describe('Import as established historical facts. Two effects, both off by default so a normal import is unchanged: (1) skip the state_machine rule so mid-lifecycle rows (e.g. already-closed tickets, closed_won deals) are not rejected by initialStates; and (2) preserve the original audit timeline — keep the supplied created_at / updated_at / updated_by and author-declared business readonly fields (e.g. closed_at, resolved_by) instead of stamping-now / stripping them. Undoing a historical import mirrors (2): the captured pre-import values are restored verbatim rather than re-stamped. Only the system principal (an in-process caller such as a seed or migration job) may send `treatAsHistorical: true`: the import doors refuse it from every other caller, every signed-in user and administrator included, with `403 PERMISSION_DENIED` before any row is read.'),
  trimWhitespace: z.boolean().default(true)
    .describe('Trim leading/trailing whitespace from string cells'),
  nullValues: z.array(z.string()).optional()
    .describe('Strings treated as null/blank (besides empty string)'),
  createMissingOptions: z.boolean().default(false)
    .describe(
      'Keep a select / radio / multiselect cell that matches none of the field\'s options instead of ' +
      'failing the row. The cell is stored as written (trimmed; for a multi-value cell, each unmatched item), ' +
      'and the engine\'s option check admits exactly the values this import kept, on this import\'s writes ' +
      '(dry run included). The field\'s option list is not changed: a later write that sends the field is ' +
      'judged against the options again, while one that leaves the field out is not affected. A field bound ' +
      'to a shared picklist that did not resolve is still refused.',
    ),
  skipBlankMatchKey: z.boolean().default(false)
    .describe('Skip rows whose matchFields are blank (default: upsert creates them, update skips them). One key set only: with ordered key sets a row blank on every set is a row error.'),
}).refine((body) => !(body.mappingName && body.mapping), {
  // Same exclusion the route enforces (400 CONFLICTING_MAPPING in
  // `packages/rest/src/import-prepare.ts`) — surfaced at authoring time for
  // anyone building the body through the schema. The route check stays: it
  // parses the raw body itself, so the wire-level refusal never depends on
  // callers having used this schema.
  message: 'Provide either mappingName or an inline mapping, not both',
  path: ['mappingName'],
}).refine((body) => !(body.skipBlankMatchKey && isMatchKeySets(body.matchFields)), {
  // Same refusal the route answers (400 INVALID_REQUEST in
  // `packages/rest/src/import-prepare.ts`): ordered key sets report a row
  // blank on every set as a row error, so a request asking to skip such rows
  // silently contradicts the form it chose.
  message: 'skipBlankMatchKey applies to one key set only; with ordered key sets a row blank on every set is reported as a row error',
  path: ['skipBlankMatchKey'],
}));

/**
 * Whether an import's `matchFields` uses the ordered key-set form
 * (`string[][]`) rather than one key set (`string[]`).
 */
export function isMatchKeySets(matchFields: unknown): matchFields is string[][] {
  return Array.isArray(matchFields) && matchFields.length > 0 && matchFields.every((set) => Array.isArray(set));
}
export type ImportRequest = z.input<typeof ImportRequestSchema>;
/** Post-parse shape of {@link ImportRequest} — defaults applied, transforms run (ADR-0122). */
export type ImportRequestParsed = z.infer<typeof ImportRequestSchema>;

/**
 * Import Row Result
 * Per-row outcome so a UI can render an import report and offer a failed-row
 * re-export.
 *
 * Two optional report keys ride on an `ok` row, and neither changes its
 * `ok` / `action`:
 *
 * - `warnings` was SERVED before it was declared: the import runner's
 *   dry-run branch (`packages/core/src/utils/import-runner.ts`) copies the
 *   admitted findings of the engine's validate verdict onto the row, and both the
 *   synchronous route and the async job's results carry it (the synchronous
 *   route is pinned at the wire by
 *   `packages/rest/src/import-dryrun-parity.test.ts`; no test reads it off the
 *   async job's results). Undeclared, it was
 *   invisible to every reader typed by this schema, and
 *   `ImportRowResultSchema.parse` stripped it.
 * - `droppedFields` is per row rather than import-wide, so the report keeps
 *   which row dropped what. The engine reports its strips per row (the
 *   verdict `validateData` answers each row with, the outcome `insertManyData`
 *   answers it with, and the single-row create/update response), and the
 *   import runner (`packages/core/src/utils/import-runner.ts`) copies that
 *   report onto the row verbatim, on the dry run and on the commit. Two
 *   places it cannot, which is why the describe says an absent key does not
 *   prove nothing was dropped: a create batched through `createManyData`,
 *   whose report is a batch-level union that names no row; and the
 *   `readonlyWhen` / primary-key strips of a row the import UPDATES, which an
 *   `update`-mode preview does not run (see `ValidateDataResponseSchema`),
 *   so that row's dry run can name fewer fields than its commit. The element
 *   IS {@link DroppedFieldsEventSchema}, so the `reason` vocabulary is the
 *   engine's — ⛔ never a second enum here.
 *
 * One optional report key rides on a `failed` row: `errors`, every cell error
 * of that row, so one import tells the user about every bad cell instead of
 * one per re-import. The first-error keys `field`, `code` and `error` stay and
 * keep naming element 0, so a reader of those keys is unchanged. The element
 * IS {@link ValidateDataIssueSchema}, the shape the row's `warnings` and the
 * validate verdict's `errors` already use, rather than a third issue shape: a
 * cell error is `{ field, code, message }`, and it never carries the
 * advisory-only `rule` / `severity`.
 */
export const ImportRowResultSchema = lazySchema(() => z.object({
  row: z.number().int().describe('1-based row number in the source data'),
  ok: z.boolean().describe('Whether the row succeeded'),
  action: z.enum(['created', 'updated', 'skipped', 'failed'])
    .describe('What happened to the row'),
  id: z.string().optional().describe('Record id (created/updated rows)'),
  field: z.string().optional().describe('Field that caused a coercion/validation error (element 0 of `errors` when present)'),
  code: z.string().optional().describe('Error code (failed rows; element 0 of `errors` when present)'),
  error: z.string().optional().describe('Human-readable error message (failed rows; element 0 of `errors` when present)'),
  errors: z.array(ValidateDataIssueSchema).optional().describe(
    'Every cell error of a failed row, one element per failed cell, in the validate verdict\'s issue shape '
    + '(`field`, `code`, `message`). The list holds the import\'s cell-coercion errors, and a cell error never '
    + 'carries the advisory-only `rule` or `severity`. '
    + 'Present only on a failed row that has at least one cell error, so a row '
    + 'that failed for another reason (a duplicate or ambiguous match key, say) omits it. The first-error keys '
    + '`field`, `code` and `error` stay and name element 0, so a reader of those keys sees the same answer '
    + 'as before. A server that does not produce this list omits the key, and the row then reports its first '
    + 'error only.',
  ),
  warnings: z.array(ValidateDataIssueSchema).optional().describe(
    'Findings this deployment ADMITS rather than rejects, copied verbatim from the validate verdict\'s row '
    + '`warnings`: ADR-0104 value shapes under a warn-first posture, then the hits of advisory validation rules '
    + '(`severity: \'warning\'` or `\'info\'`, each naming its `rule` and `severity`). Set only on a dry-run row '
    + 'the verdict accepted: the row is `ok` because the write would store it. A committed row does not carry '
    + 'it: the import does not copy a write answer\'s `warnings` onto the row.',
  ),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability: caller-supplied fields the engine LEGALLY strips from THIS row, one event per '
    + 'reason, in the engine\'s own `droppedFields` shape and reason vocabulary. A committed row reports the '
    + 'strips its write made. A dry-run row reports the strips its preview runs, which for a row the import '
    + 'would update excludes `readonlyWhen` and primary-key strips, so that row can name fewer fields than '
    + 'its commit. The row still succeeds: '
    + '`ok` and `action` are unchanged. Present only when at least one field was dropped. A server or write '
    + 'path that does not produce this report omits the key too, so an absent key alone does not prove nothing was '
    + 'dropped. In an async job\'s `results`, an ok row\'s drops reach the reader only if the row falls '
    + 'inside that capped, failures-first sample.',
  ),
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
 * Import Job Status — the states the import worker actually moves a job
 * through (`succeeded`, not `completed`, is the success terminal).
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
  revertedAt: z.string().optional().describe('When the job was undone / rolled back (ISO 8601): set only once every row is reverted. An undo that left rows unreverted sets nothing, and the job stays undoable for those rows.'),
  error: z.string().optional().describe('Fatal error message (when status = failed)'),
  startedAt: z.string().optional().describe('Processing start timestamp (ISO 8601)'),
  completedAt: z.string().optional().describe('Completion timestamp (ISO 8601)'),
  createdAt: z.string().describe('Job creation timestamp (ISO 8601)'),
}));
export type ImportJobProgress = z.input<typeof ImportJobProgressSchema>;

/**
 * Import Job Results — the progress payload plus a capped sample of per-row
 * outcomes (failures first) so a UI can render the report / failed-row export.
 *
 * The sample is the whole of what an async reader gets per row: a report that
 * rides on an `ok` row (`droppedFields`, `warnings`) is visible only for the
 * ok rows that fit inside the cap after every failure. The cap itself is the
 * REST server's, and this contract does not change it.
 */
export const ImportJobResultsSchema = lazySchema(() => ImportJobProgressSchema.extend({
  results: z.array(ImportRowResultSchema).describe(
    'Capped sample of per-row outcomes, failures first. An ok row, and any `droppedFields` or `warnings` it '
    + 'carries, reaches this reader only if it falls inside the sample; `resultsTruncated` says whether the '
    + 'sample is partial, and the job counters count every row.',
  ),
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
  revertedAt: z.string().optional().describe('When the job was undone / rolled back (ISO 8601): set only once every row is reverted. An undo that left rows unreverted sets nothing, and the job stays undoable for those rows.'),
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
 *
 * The reversal writes are ordinary writes on the live app: for every caller but
 * the system principal they run under the object's hooks, record-change
 * triggers and `state_machine` rule, so a control can refuse a row. Each row
 * the undo did not revert is listed in `failures` and is not counted as
 * reverted; the job is stamped reverted only once every row is, and until then
 * it stays undoable for exactly the rows that remain.
 */
export const UndoImportJobResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether every row was reverted. False when any row is listed in `failures`: the undo did not complete, and the job is not stamped reverted.'),
  jobId: z.string().describe('Import job id'),
  object: z.string().describe('Target object name'),
  deleted: z.number().int().describe('Created records deleted'),
  restored: z.number().int().describe('Updated records restored to pre-import values'),
  failed: z.number().int().describe('Rows the undo did not revert: one per entry in `failures`'),
  failures: z.array(z.object({
    id: z.string().describe('Id of the record the reversal targeted'),
    action: z.enum(['delete', 'restore']).describe('The reversal that did not happen: `delete` for a record the import created, `restore` for one it updated'),
    code: z.string().describe('Error code the write was refused or failed with, as the single-record write door answers it'),
    error: z.string().describe('Human-readable message: a refusing hook or validation rule\'s own sentence, or the door\'s withheld-fault sentence'),
  })).describe(
    'One entry per row the undo did not revert, in the order the undo tried them (deletes first). For every caller '
    + 'but the system principal the reversal writes run under the object\'s hooks, record-change triggers and '
    + '`state_machine` rule, so a row one of them refuses is listed here, as is a write that failed for any other '
    + 'reason. The job keeps these rows, each with its entry, in its undo log and stays undoable: undoing it again '
    + 'retries only them. Empty when every row was reverted.',
  ),
}));
export type UndoImportJobResponse = z.input<typeof UndoImportJobResponseSchema>;

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
