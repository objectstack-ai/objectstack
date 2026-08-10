import { describe, it, expect } from 'vitest';
import {
  ExportFormat,
  ExportJobStatus,
  CreateExportJobRequestSchema,
  CreateExportJobResponseSchema,
  ExportJobProgressSchema,
  ImportValidationMode,
  DeduplicationStrategy,
  ImportValidationConfigSchema,
  ImportValidationResultSchema,
  FieldMappingEntrySchema,
  ExportImportTemplateSchema,
  ScheduledExportSchema,
  ExportApiContracts,
  GetExportJobDownloadRequestSchema,
  GetExportJobDownloadResponseSchema,
  ListExportJobsRequestSchema,
  ListExportJobsResponseSchema,
  ExportJobSummarySchema,
  ScheduleExportRequestSchema,
  ScheduleExportResponseSchema,
  ImportRequestSchema,
  CreateImportJobRequestSchema,
} from './export.zod';

// ==========================================
// Export Format
// ==========================================

describe('ExportFormat', () => {
  it('should accept all valid formats', () => {
    const valid = ['csv', 'json', 'jsonl', 'xlsx', 'parquet'];
    valid.forEach((v) => {
      expect(() => ExportFormat.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid formats', () => {
    expect(() => ExportFormat.parse('xml')).toThrow();
    expect(() => ExportFormat.parse('CSV')).toThrow();
  });
});

// ==========================================
// Export Job Status
// ==========================================

describe('ExportJobStatus', () => {
  it('should accept all valid statuses', () => {
    const valid = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'expired'];
    valid.forEach((v) => {
      expect(() => ExportJobStatus.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => ExportJobStatus.parse('running')).toThrow();
    expect(() => ExportJobStatus.parse('PENDING')).toThrow();
  });
});

// ==========================================
// Create Export Job Request
// ==========================================

describe('CreateExportJobRequestSchema', () => {
  it('should accept a minimal request with defaults', () => {
    const req = CreateExportJobRequestSchema.parse({
      object: 'account',
    });
    expect(req.object).toBe('account');
    expect(req.format).toBe('csv');
    expect(req.includeHeaders).toBe(true);
    expect(req.encoding).toBe('utf-8');
    expect(req.fields).toBeUndefined();
    expect(req.filter).toBeUndefined();
  });

  it('should accept a full request', () => {
    const req = CreateExportJobRequestSchema.parse({
      object: 'contact',
      format: 'xlsx',
      fields: ['name', 'email', 'phone'],
      filter: { status: 'active' },
      sort: [
        { field: 'name', direction: 'asc' },
        { field: 'created_at', direction: 'desc' },
      ],
      limit: 10000,
      includeHeaders: false,
      encoding: 'utf-16',
      templateId: 'tmpl_001',
    });
    expect(req.format).toBe('xlsx');
    expect(req.fields).toHaveLength(3);
    expect(req.sort).toHaveLength(2);
    expect(req.limit).toBe(10000);
    expect(req.includeHeaders).toBe(false);
  });

  it('should reject missing object', () => {
    expect(() => CreateExportJobRequestSchema.parse({
      format: 'csv',
    })).toThrow();
  });

  it('should reject invalid format', () => {
    expect(() => CreateExportJobRequestSchema.parse({
      object: 'account',
      format: 'xml',
    })).toThrow();
  });
});

// ==========================================
// Create Export Job Response
// ==========================================

describe('CreateExportJobResponseSchema', () => {
  it('should accept a valid response', () => {
    const resp = CreateExportJobResponseSchema.parse({
      success: true,
      data: {
        jobId: 'job_001',
        status: 'pending',
        estimatedRecords: 5000,
        createdAt: '2026-02-01T10:00:00Z',
      },
    });
    expect(resp.data.jobId).toBe('job_001');
    expect(resp.data.status).toBe('pending');
    expect(resp.data.estimatedRecords).toBe(5000);
  });

  it('should reject missing jobId', () => {
    expect(() => CreateExportJobResponseSchema.parse({
      success: true,
      data: {
        status: 'pending',
        createdAt: '2026-02-01T10:00:00Z',
      },
    })).toThrow();
  });
});

// ==========================================
// Export Job Progress
// ==========================================

describe('ExportJobProgressSchema', () => {
  it('should accept an in-progress job', () => {
    const progress = ExportJobProgressSchema.parse({
      success: true,
      data: {
        jobId: 'job_001',
        status: 'processing',
        format: 'csv',
        totalRecords: 10000,
        processedRecords: 4500,
        percentComplete: 45,
        fileSize: 2048000,
        startedAt: '2026-02-01T10:00:05Z',
      },
    });
    expect(progress.data.processedRecords).toBe(4500);
    expect(progress.data.percentComplete).toBe(45);
    expect(progress.data.downloadUrl).toBeUndefined();
  });

  it('should accept a completed job with download URL', () => {
    const progress = ExportJobProgressSchema.parse({
      success: true,
      data: {
        jobId: 'job_001',
        status: 'completed',
        format: 'csv',
        totalRecords: 10000,
        processedRecords: 10000,
        percentComplete: 100,
        fileSize: 5242880,
        downloadUrl: 'https://storage.example.com/exports/job_001.csv?token=abc',
        downloadExpiresAt: '2026-02-02T10:00:00Z',
        startedAt: '2026-02-01T10:00:05Z',
        completedAt: '2026-02-01T10:05:00Z',
      },
    });
    expect(progress.data.downloadUrl).toContain('storage.example.com');
    expect(progress.data.percentComplete).toBe(100);
  });

  it('should accept a failed job with error', () => {
    const progress = ExportJobProgressSchema.parse({
      success: true,
      data: {
        jobId: 'job_002',
        status: 'failed',
        format: 'json',
        processedRecords: 500,
        percentComplete: 5,
        error: {
          code: 'EXPORT_TIMEOUT',
          message: 'Export timed out after 30 minutes',
        },
      },
    });
    expect(progress.data.error?.code).toBe('EXPORT_TIMEOUT');
  });
});

// ==========================================
// Import Validation Mode & Deduplication Strategy
// ==========================================

describe('ImportValidationMode', () => {
  it('should accept all valid modes', () => {
    const valid = ['strict', 'lenient', 'dry_run'];
    valid.forEach((v) => {
      expect(() => ImportValidationMode.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid modes', () => {
    expect(() => ImportValidationMode.parse('relaxed')).toThrow();
  });
});

describe('DeduplicationStrategy', () => {
  it('should accept all valid strategies', () => {
    const valid = ['skip', 'update', 'create_new', 'fail'];
    valid.forEach((v) => {
      expect(() => DeduplicationStrategy.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid strategies', () => {
    expect(() => DeduplicationStrategy.parse('merge')).toThrow();
  });
});

// ==========================================
// Import Validation Config
// ==========================================

describe('ImportValidationConfigSchema', () => {
  it('should apply defaults', () => {
    const config = ImportValidationConfigSchema.parse({});
    expect(config.mode).toBe('strict');
    expect(config.maxErrors).toBe(100);
    expect(config.trimWhitespace).toBe(true);
    expect(config.deduplication).toBeUndefined();
  });

  it('should accept a full config', () => {
    const config = ImportValidationConfigSchema.parse({
      mode: 'lenient',
      deduplication: {
        strategy: 'update',
        matchFields: ['email', 'external_id'],
      },
      maxErrors: 50,
      trimWhitespace: false,
      dateFormat: 'YYYY-MM-DD',
      nullValues: ['', 'N/A', 'null'],
    });
    expect(config.mode).toBe('lenient');
    expect(config.deduplication?.strategy).toBe('update');
    expect(config.deduplication?.matchFields).toHaveLength(2);
    expect(config.nullValues).toHaveLength(3);
  });

  it('should reject deduplication with empty matchFields', () => {
    expect(() => ImportValidationConfigSchema.parse({
      deduplication: {
        strategy: 'skip',
        matchFields: [],
      },
    })).toThrow();
  });
});

// ==========================================
// Import Validation Result
// ==========================================

describe('ImportValidationResultSchema', () => {
  it('should accept a valid result', () => {
    const result = ImportValidationResultSchema.parse({
      success: true,
      data: {
        totalRecords: 1000,
        validRecords: 980,
        invalidRecords: 15,
        duplicateRecords: 5,
        errors: [
          { row: 42, field: 'email', code: 'INVALID_FORMAT', message: 'Invalid email format' },
          { row: 99, code: 'MISSING_REQUIRED', message: 'Missing required field "name"' },
        ],
        preview: [{ name: 'Acme Corp', email: 'info@acme.com' }],
      },
    });
    expect(result.data.totalRecords).toBe(1000);
    expect(result.data.errors).toHaveLength(2);
    expect(result.data.errors[0].row).toBe(42);
  });

  it('should reject missing required data fields', () => {
    expect(() => ImportValidationResultSchema.parse({
      success: true,
      data: {
        totalRecords: 100,
        validRecords: 100,
      },
    })).toThrow(); // missing invalidRecords, duplicateRecords, errors
  });
});

// ==========================================
// Field Mapping Entry
// ==========================================

describe('FieldMappingEntrySchema', () => {
  it('should accept a valid mapping with defaults', () => {
    const mapping = FieldMappingEntrySchema.parse({
      sourceField: 'name',
      targetField: 'Company Name',
    });
    expect(mapping.transform).toBe('none');
    expect(mapping.required).toBe(false);
    expect(mapping.defaultValue).toBeUndefined();
  });

  it('should accept a mapping with transform', () => {
    const mapping = FieldMappingEntrySchema.parse({
      sourceField: 'email',
      targetField: 'Email Address',
      targetLabel: 'Email',
      transform: 'lowercase',
      defaultValue: 'unknown@example.com',
      required: true,
    });
    expect(mapping.transform).toBe('lowercase');
    expect(mapping.required).toBe(true);
  });

  it('should accept all valid transforms', () => {
    const valid = ['none', 'uppercase', 'lowercase', 'trim', 'date_format', 'lookup'];
    valid.forEach((v) => {
      expect(() => FieldMappingEntrySchema.parse({
        sourceField: 'a',
        targetField: 'b',
        transform: v,
      })).not.toThrow();
    });
  });

  it('should reject invalid transform', () => {
    expect(() => FieldMappingEntrySchema.parse({
      sourceField: 'a',
      targetField: 'b',
      transform: 'encrypt',
    })).toThrow();
  });
});

// ==========================================
// Export/Import Template
// ==========================================

describe('ExportImportTemplateSchema', () => {
  it('should accept a valid template', () => {
    const template = ExportImportTemplateSchema.parse({
      name: 'account_export_v1',
      label: 'Account Export (Standard)',
      description: 'Standard account export template',
      object: 'account',
      direction: 'export',
      format: 'csv',
      mappings: [
        { sourceField: 'name', targetField: 'Company Name' },
        { sourceField: 'email', targetField: 'Email', transform: 'lowercase' },
      ],
      createdBy: 'user_admin',
    });
    expect(template.name).toBe('account_export_v1');
    expect(template.mappings).toHaveLength(2);
    expect(template.direction).toBe('export');
  });

  it('should reject invalid name (not snake_case)', () => {
    expect(() => ExportImportTemplateSchema.parse({
      name: 'AccountExport',
      label: 'Account Export',
      object: 'account',
      direction: 'export',
      mappings: [{ sourceField: 'a', targetField: 'b' }],
    })).toThrow();
  });

  it('should reject empty mappings', () => {
    expect(() => ExportImportTemplateSchema.parse({
      name: 'empty_template',
      label: 'Empty',
      object: 'account',
      direction: 'import',
      mappings: [],
    })).toThrow();
  });

  it('should accept all valid directions', () => {
    const valid = ['import', 'export', 'bidirectional'];
    valid.forEach((v) => {
      expect(() => ExportImportTemplateSchema.parse({
        name: 'test_template',
        label: 'Test',
        object: 'account',
        direction: v,
        mappings: [{ sourceField: 'a', targetField: 'b' }],
      })).not.toThrow();
    });
  });
});

// ==========================================
// Scheduled Export
// ==========================================

describe('ScheduledExportSchema', () => {
  it('should accept a valid scheduled export', () => {
    const sched = ScheduledExportSchema.parse({
      name: 'weekly_account_export',
      label: 'Weekly Account Export',
      object: 'account',
      format: 'csv',
      fields: ['name', 'email', 'status'],
      filter: { status: 'active' },
      schedule: {
        cronExpression: '0 6 * * MON',
        timezone: 'America/New_York',
      },
      delivery: {
        method: 'email',
        recipients: ['admin@example.com', 'ops@example.com'],
      },
    });
    expect(sched.name).toBe('weekly_account_export');
    expect(sched.schedule.cronExpression).toEqual({ dialect: 'cron', source: '0 6 * * MON' });
    expect(sched.delivery.method).toBe('email');
    expect(sched.enabled).toBe(true);
  });

  it('should apply defaults', () => {
    const sched = ScheduledExportSchema.parse({
      name: 'daily_export',
      object: 'order',
      schedule: { cronExpression: '0 0 * * *' },
      delivery: { method: 'storage', storagePath: '/exports/daily/' },
    });
    expect(sched.format).toBe('csv');
    expect(sched.enabled).toBe(true);
    expect(sched.schedule.timezone).toBe('UTC');
  });

  it('should reject invalid name (not snake_case)', () => {
    expect(() => ScheduledExportSchema.parse({
      name: 'WeeklyExport',
      object: 'account',
      schedule: { cronExpression: '0 6 * * MON' },
      delivery: { method: 'email' },
    })).toThrow();
  });

  it('should accept all delivery methods', () => {
    const methods = ['email', 'storage', 'webhook'];
    methods.forEach((m) => {
      expect(() => ScheduledExportSchema.parse({
        name: 'test_export',
        object: 'account',
        schedule: { cronExpression: '0 0 * * *' },
        delivery: { method: m },
      })).not.toThrow();
    });
  });
});

// ==========================================
// Get Export Job Download
// ==========================================

describe('GetExportJobDownloadRequestSchema', () => {
  it('should accept a valid request', () => {
    const req = GetExportJobDownloadRequestSchema.parse({ jobId: 'job_001' });
    expect(req.jobId).toBe('job_001');
  });

  it('should reject missing jobId', () => {
    expect(() => GetExportJobDownloadRequestSchema.parse({})).toThrow();
  });
});

describe('GetExportJobDownloadResponseSchema', () => {
  it('should accept a valid response', () => {
    const resp = GetExportJobDownloadResponseSchema.parse({
      success: true,
      data: {
        jobId: 'job_001',
        downloadUrl: 'https://storage.example.com/exports/job_001.csv?token=abc',
        fileName: 'account_export_2026-02-01.csv',
        fileSize: 5242880,
        format: 'csv',
        expiresAt: '2026-02-02T10:00:00Z',
        checksum: 'sha256:abc123',
      },
    });
    expect(resp.data.downloadUrl).toContain('storage.example.com');
    expect(resp.data.fileName).toContain('.csv');
    expect(resp.data.checksum).toBe('sha256:abc123');
  });

  it('should accept response without optional checksum', () => {
    const resp = GetExportJobDownloadResponseSchema.parse({
      success: true,
      data: {
        jobId: 'job_001',
        downloadUrl: 'https://storage.example.com/exports/job_001.json',
        fileName: 'export.json',
        fileSize: 1024,
        format: 'json',
        expiresAt: '2026-02-02T10:00:00Z',
      },
    });
    expect(resp.data.checksum).toBeUndefined();
  });
});

// ==========================================
// List Export Jobs
// ==========================================

describe('ListExportJobsRequestSchema', () => {
  it('should apply defaults', () => {
    const req = ListExportJobsRequestSchema.parse({});
    expect(req.limit).toBe(20);
    expect(req.object).toBeUndefined();
    expect(req.status).toBeUndefined();
    expect(req.cursor).toBeUndefined();
  });

  it('should accept a full request', () => {
    const req = ListExportJobsRequestSchema.parse({
      object: 'account',
      status: 'completed',
      limit: 50,
      cursor: 'cursor_abc',
    });
    expect(req.object).toBe('account');
    expect(req.status).toBe('completed');
    expect(req.limit).toBe(50);
    expect(req.cursor).toBe('cursor_abc');
  });

  it('should reject limit exceeding max', () => {
    expect(() => ListExportJobsRequestSchema.parse({ limit: 200 })).toThrow();
  });
});

describe('ExportJobSummarySchema', () => {
  it('should accept a valid summary', () => {
    const summary = ExportJobSummarySchema.parse({
      jobId: 'job_001',
      object: 'account',
      status: 'completed',
      format: 'csv',
      totalRecords: 5000,
      fileSize: 2048000,
      createdAt: '2026-02-01T10:00:00Z',
      completedAt: '2026-02-01T10:05:00Z',
      createdBy: 'user_admin',
    });
    expect(summary.jobId).toBe('job_001');
    expect(summary.totalRecords).toBe(5000);
  });
});

describe('ListExportJobsResponseSchema', () => {
  it('should accept a response with jobs', () => {
    const resp = ListExportJobsResponseSchema.parse({
      success: true,
      data: {
        jobs: [
          {
            jobId: 'job_001',
            object: 'account',
            status: 'completed',
            format: 'csv',
            createdAt: '2026-02-01T10:00:00Z',
          },
        ],
        nextCursor: 'cursor_next',
        hasMore: true,
      },
    });
    expect(resp.data.jobs).toHaveLength(1);
    expect(resp.data.nextCursor).toBe('cursor_next');
    expect(resp.data.hasMore).toBe(true);
  });

  it('should accept an empty list', () => {
    const resp = ListExportJobsResponseSchema.parse({
      success: true,
      data: {
        jobs: [],
        hasMore: false,
      },
    });
    expect(resp.data.jobs).toHaveLength(0);
    expect(resp.data.hasMore).toBe(false);
  });
});

// ==========================================
// Schedule Export Request/Response
// ==========================================

describe('ScheduleExportRequestSchema', () => {
  it('should accept a valid request', () => {
    const req = ScheduleExportRequestSchema.parse({
      name: 'weekly_account_export',
      label: 'Weekly Account Export',
      object: 'account',
      format: 'csv',
      fields: ['name', 'email'],
      schedule: {
        cronExpression: '0 6 * * MON',
        timezone: 'America/New_York',
      },
      delivery: {
        method: 'email',
        recipients: ['admin@example.com'],
      },
    });
    expect(req.name).toBe('weekly_account_export');
    expect(req.schedule.cronExpression).toEqual({ dialect: 'cron', source: '0 6 * * MON' });
    expect(req.delivery.method).toBe('email');
  });

  it('should apply defaults', () => {
    const req = ScheduleExportRequestSchema.parse({
      name: 'daily_export',
      object: 'order',
      schedule: { cronExpression: '0 0 * * *' },
      delivery: { method: 'storage', storagePath: '/exports/daily/' },
    });
    expect(req.format).toBe('csv');
    expect(req.schedule.timezone).toBe('UTC');
  });

  it('should reject invalid name (not snake_case)', () => {
    expect(() => ScheduleExportRequestSchema.parse({
      name: 'WeeklyExport',
      object: 'account',
      schedule: { cronExpression: '0 6 * * MON' },
      delivery: { method: 'email' },
    })).toThrow();
  });
});

describe('ScheduleExportResponseSchema', () => {
  it('should accept a valid response', () => {
    const resp = ScheduleExportResponseSchema.parse({
      success: true,
      data: {
        id: 'sched_001',
        name: 'weekly_account_export',
        enabled: true,
        nextRunAt: '2026-02-24T06:00:00Z',
        createdAt: '2026-02-21T09:00:00Z',
      },
    });
    expect(resp.data.id).toBe('sched_001');
    expect(resp.data.enabled).toBe(true);
    expect(resp.data.nextRunAt).toBeDefined();
  });
});

// ==========================================
// Export API Contracts
// ==========================================

describe('ExportApiContracts', () => {
  it('should define 6 contracts', () => {
    expect(Object.keys(ExportApiContracts)).toHaveLength(6);
  });

  it('should have correct HTTP methods', () => {
    expect(ExportApiContracts.createExportJob.method).toBe('POST');
    expect(ExportApiContracts.getExportJobProgress.method).toBe('GET');
    expect(ExportApiContracts.getExportJobDownload.method).toBe('GET');
    expect(ExportApiContracts.listExportJobs.method).toBe('GET');
    expect(ExportApiContracts.scheduleExport.method).toBe('POST');
    expect(ExportApiContracts.cancelExportJob.method).toBe('POST');
  });

  it('should have valid paths', () => {
    expect(ExportApiContracts.createExportJob.path).toContain('/export');
    expect(ExportApiContracts.getExportJobProgress.path).toContain('/export');
    expect(ExportApiContracts.getExportJobDownload.path).toContain('/download');
    expect(ExportApiContracts.listExportJobs.path).toBe('/api/v1/data/export');
    expect(ExportApiContracts.scheduleExport.path).toContain('/schedules');
    expect(ExportApiContracts.cancelExportJob.path).toContain('/cancel');
  });

  it('should have input/output schemas for all contracts', () => {
    Object.values(ExportApiContracts).forEach((contract) => {
      expect(contract.output).toBeDefined();
    });
  });
});

// ==========================================
// Import Request — runAutomations declared default (#6704)
// ==========================================

/**
 * The DECLARED default of `runAutomations`, pinned against the value the server
 * actually applies.
 *
 * This half of the pin is deliberately schema-local: it asserts what a consumer
 * who validates a request body through the published schema MATERIALISES. The
 * other half — that the materialised value is the same one
 * `POST /data/:object/import` decides on — lives in
 * `packages/rest/src/import-run-automations-agreement.test.ts`, because only
 * that package can reach both the schema and `prepareImportRequest`. Neither
 * half alone is the fact #6704 is about: the fact is the AGREEMENT.
 *
 * Before #6704 the two disagreed on exactly one input — the omitted key — and
 * that is the case a reader should look at first.
 */
describe('ImportRequestSchema — runAutomations declared default (#6704)', () => {
  const bodyWithout = { format: 'json' as const, rows: [{ title: 'a' }] };

  it('materialises `true` when the caller omits the key', () => {
    expect(ImportRequestSchema.parse(bodyWithout).runAutomations).toBe(true);
  });

  it('keeps an explicit opt-out — `false` survives the parse', () => {
    expect(ImportRequestSchema.parse({ ...bodyWithout, runAutomations: false }).runAutomations)
      .toBe(false);
  });

  it('keeps an explicit opt-in', () => {
    expect(ImportRequestSchema.parse({ ...bodyWithout, runAutomations: true }).runAutomations)
      .toBe(true);
  });

  it('says the same thing on the async job body — it is the same schema object', () => {
    // `CreateImportJobRequestSchema === ImportRequestSchema`, but both defs are
    // PUBLISHED separately (two JSON Schema files, two reference tables, two
    // authorable-defaults rows), so the async twin is asserted by name rather
    // than left to the reader to infer from the aliasing.
    expect(CreateImportJobRequestSchema.parse(bodyWithout).runAutomations).toBe(true);
    expect(
      CreateImportJobRequestSchema.parse({ ...bodyWithout, runAutomations: false }).runAutomations,
    ).toBe(false);
  });

  it('describes the default it declares — the prose ships in the reference tables', () => {
    // The old prose ("off by default for bulk") rendered into
    // `content/docs/references/api/export.mdx` for BOTH defs and told an author
    // the opposite of what the server does. Pin the direction, not the wording.
    const described = (ImportRequestSchema.shape.runAutomations as { description?: string })
      .description ?? '';
    expect(described).not.toMatch(/off by default/i);
    expect(described).toMatch(/ON by default/);
  });
});
