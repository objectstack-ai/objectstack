// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IExportService - Data Export Service Contract
 *
 * Defines the interface for streaming data export, import validation,
 * template management, and scheduled export operations in ObjectStack.
 * Concrete implementations (in-memory, database-backed, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete export service implementations.
 *
 * Not a `CoreServiceName` member and not a registered runtime service
 * slot — `IExportService` has no evidenced provider binding (see
 * core-service-contracts.ts's evidence-bar note).
 */

import type {
  ExportFormat,
  ExportJobStatus,
  ExportJobProgress,
  ExportJobSummary,
  ExportImportTemplate,
  ScheduledExport,
} from '../api/export.zod';

// ==========================================
// Export Job Types
// ==========================================

/**
 * Input for creating a new export job.
 */
export interface CreateExportJobInput {
  /** Object name to export */
  object: string;
  /** Export file format */
  format?: ExportFormat;
  /** Specific fields to include (omit for all fields) */
  fields?: string[];
  /** Filter criteria for records to export */
  filter?: Record<string, unknown>;
  /** Sort order for exported records */
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  /** Maximum number of records to export */
  limit?: number;
  /** Include header row (CSV/XLSX) */
  includeHeaders?: boolean;
  /** Character encoding */
  encoding?: string;
  /** Export template ID for predefined field mappings */
  templateId?: string;
}

/**
 * Result of creating an export job.
 */
export interface CreateExportJobResult {
  /** Export job ID */
  jobId: string;
  /** Initial job status */
  status: ExportJobStatus;
  /** Estimated total records */
  estimatedRecords?: number;
  /** Job creation timestamp (ISO 8601) */
  createdAt: string;
}

/**
 * Download link info for a completed export job.
 */
export interface ExportJobDownload {
  /** Export job ID */
  jobId: string;
  /** Presigned download URL */
  downloadUrl: string;
  /** Suggested file name */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** Export file format */
  format: ExportFormat;
  /** Download URL expiration timestamp (ISO 8601) */
  expiresAt: string;
  /** File checksum (SHA-256) */
  checksum?: string;
}

/**
 * Options for listing export jobs.
 */
export interface ListExportJobsOptions {
  /** Filter by object name */
  object?: string;
  /** Filter by job status */
  status?: ExportJobStatus;
  /** Maximum number of jobs to return */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Paginated list of export jobs.
 */
export interface ExportJobListResult {
  /** Export job summaries */
  jobs: ExportJobSummary[];
  /** Cursor for the next page */
  nextCursor?: string;
  /** Whether more jobs are available */
  hasMore: boolean;
}

/**
 * Input for scheduling a recurring export.
 */
export interface ScheduleExportInput {
  /** Schedule name (snake_case) */
  name: string;
  /** Human-readable label */
  label?: string;
  /** Object name to export */
  object: string;
  /** Export file format */
  format?: ExportFormat;
  /** Fields to include */
  fields?: string[];
  /** Record filter criteria */
  filter?: Record<string, unknown>;
  /** Export template ID */
  templateId?: string;
  /** Schedule timing configuration */
  schedule: {
    cronExpression: string;
    timezone?: string;
  };
  /** Export delivery configuration */
  delivery: {
    method: 'email' | 'storage' | 'webhook';
    recipients?: string[];
    storagePath?: string;
    webhookUrl?: string;
  };
}

// ==========================================
// Service Interface
// ==========================================

export interface IExportService {
  // ---- Export Jobs ----

  /**
   * Create a new export job.
   * @param input - Export job configuration
   * @returns The created export job with tracking info
   */
  createExportJob(input: CreateExportJobInput): Promise<CreateExportJobResult>;

  /**
   * Get the progress/status of an export job.
   * @param jobId - Export job ID
   * @returns Export job progress, or null if not found
   */
  getExportJobProgress(jobId: string): Promise<ExportJobProgress | null>;

  /**
   * Get the download link for a completed export job.
   * @param jobId - Export job ID
   * @returns Download link info, or null if not available
   */
  getExportJobDownload(jobId: string): Promise<ExportJobDownload | null>;

  /**
   * Cancel an in-progress export job.
   * @param jobId - Export job ID
   * @returns Whether the job was successfully cancelled
   */
  cancelExportJob(jobId: string): Promise<boolean>;

  /**
   * List export jobs with optional filtering and pagination.
   * @param options - Filter and pagination options
   * @returns Paginated list of export jobs
   */
  listExportJobs(options?: ListExportJobsOptions): Promise<ExportJobListResult>;

  // ---- Scheduled Exports ----

  /**
   * Create a scheduled recurring export.
   * @param input - Schedule configuration
   * @returns The created scheduled export
   */
  scheduleExport(input: ScheduleExportInput): Promise<ScheduledExport>;

  // ---- Templates (optional) ----

  /**
   * Get an export/import template by ID.
   * @param templateId - Template ID
   * @returns The template, or null if not found
   */
  getTemplate?(templateId: string): Promise<ExportImportTemplate | null>;

  /**
   * List available export/import templates.
   * @param object - Optional object filter
   * @returns Array of templates
   */
  listTemplates?(object?: string): Promise<ExportImportTemplate[]>;
}
