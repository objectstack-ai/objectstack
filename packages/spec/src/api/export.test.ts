import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ImportRequest, ImportRowResult } from './export.zod';
import {
  ExportFormat,
  ImportValidationMode,
  DeduplicationStrategy,
  ImportValidationConfigSchema,
  ImportValidationResultSchema,
  FieldMappingEntrySchema,
  ExportImportTemplateSchema,
  ImportRequestSchema,
  CreateImportJobRequestSchema,
  ImportRowResultSchema,
  ImportJobResultsSchema,
} from './export.zod';
import type { ValidateDataIssue } from './protocol.zod';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';
import type { DroppedFieldsEvent } from '../data/data-engine.zod';

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
// Import Request — runAutomations declared default (commit c3f491626)
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
 * half alone is the fact commit c3f491626 pins: the fact is the AGREEMENT.
 *
 * Before commit c3f491626 the two disagreed on exactly one input — the omitted key — and
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

/**
 * `mappingName` declared on the contract (commit b9e9227e3).
 *
 * The wire accepted it long before the schema declared it: both import routes
 * read `body.mappingName` off the raw body in `prepareImportRequest`
 * (`packages/rest/src/import-prepare.ts`), while `ImportRequestSchema`
 * declared fifteen other keys — so the typed SDK could not express the one
 * request parameter the `mapping` metadata kind exists for (its ADR-0088
 * admission consumer, #2611). Enforced-but-undeclared, the mirror of the
 * declared-but-unenforced shape.
 *
 * The mutual exclusion with an inline `mapping` is asserted at BOTH layers on
 * purpose: the schema `.refine()` here rejects the pair for anyone building
 * the body through the published schema, and the route-level
 * `400 CONFLICTING_MAPPING` (pinned in
 * `packages/rest/src/import-integration.test.ts`) keeps refusing it on the
 * wire, because the route parses the raw body itself and never depends on
 * callers having used this schema.
 */
describe('ImportRequestSchema — mappingName declared (#10330)', () => {
  const base = { format: 'csv' as const, csv: 'Full Name,E-mail\nAda,ada@example.com\n' };

  it('parses a body naming a registered mapping, and the value survives', () => {
    const parsed = ImportRequestSchema.parse({ ...base, mappingName: 'showcase_inquiry_feed' });
    expect(parsed.mappingName).toBe('showcase_inquiry_feed');
  });

  it('parses the same body through the async twin — it is the same schema object', () => {
    // `CreateImportJobRequestSchema === ImportRequestSchema`, but both defs
    // are PUBLISHED separately, so the async route's declaration is asserted
    // by name rather than left to the reader to infer from the aliasing.
    const parsed = CreateImportJobRequestSchema
      .parse({ ...base, mappingName: 'showcase_inquiry_feed' });
    expect(parsed.mappingName).toBe('showcase_inquiry_feed');
  });

  it('the typed SDK request can express it — the #10330 TS2353 repro, inverted', () => {
    // Before the declaration this exact literal was a compile error
    // (TS2353: 'mappingName' does not exist in type …). The literal itself is
    // the pin: this file is type-checked, so the key regressing out of the
    // schema turns this line back into that error.
    const req: ImportRequest = {
      format: 'csv',
      csv: 'Full Name,E-mail\nAda,ada@example.com\n',
      mappingName: 'showcase_inquiry_feed',
    };
    expect(req.mappingName).toBe('showcase_inquiry_feed');
    expectTypeOf<ImportRequest['mappingName']>().toEqualTypeOf<string | undefined>();
  });

  it('refuses mappingName plus an inline mapping at parse, naming the conflict', () => {
    const result = ImportRequestSchema.safeParse({
      ...base,
      mappingName: 'showcase_inquiry_feed',
      mapping: { 'Full Name': 'name' },
    });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.message).toBe('Provide either mappingName or an inline mapping, not both');
    expect(issue?.path).toEqual(['mappingName']);
  });

  it('refuses the pair on the async twin too', () => {
    const result = CreateImportJobRequestSchema.safeParse({
      ...base,
      mappingName: 'showcase_inquiry_feed',
      mapping: { 'Full Name': 'name' },
    });
    expect(result.success).toBe(false);
  });

  it('keeps accepting each side alone — the refine only bites the pair', () => {
    expect(ImportRequestSchema.safeParse({ ...base, mappingName: 'x' }).success).toBe(true);
    expect(
      ImportRequestSchema.safeParse({ ...base, mapping: { 'Full Name': 'name' } }).success,
    ).toBe(true);
  });

  it('describes the exclusion — the prose ships in the reference tables', () => {
    const described = (ImportRequestSchema.shape.mappingName as { description?: string })
      .description ?? '';
    expect(described).toMatch(/[Mm]utually\s+exclusive/);
    expect(described).toMatch(/CONFLICTING_MAPPING/);
  });
});

// ==========================================
// Import Row Result — the write-drop signal and the served dry-run warnings
// ==========================================

/**
 * The row report carries two optional keys that ride on an `ok` row:
 * `droppedFields` (the engine's per-row strip report, which the import runner copies)
 * and `warnings` (served by the REST dry run before it was declared). The
 * schema is a plain, non-strict `z.object`, so an undeclared key is not
 * refused — it is STRIPPED by `parse`. Each pin therefore asserts the key
 * SURVIVES a parse, never bare `success`: a schema without the key would
 * still answer `success: true` and hand back a row with the report gone.
 */
describe('ImportRowResultSchema — droppedFields and warnings', () => {
  const okRow = { row: 2, ok: true, action: 'created' as const, id: 'rec_1' };
  const drops = [
    { object: 'project', fields: ['doubled'], reason: 'computed' as const },
    { object: 'project', fields: ['code'], reason: 'readonly' as const },
  ];

  it('parses a row without droppedFields — the key is optional', () => {
    const parsed = ImportRowResultSchema.parse(okRow);
    expect(parsed).toEqual(okRow);
    expect('droppedFields' in parsed).toBe(false);
  });

  it('parses a row with droppedFields and keeps every event', () => {
    const parsed = ImportRowResultSchema.parse({ ...okRow, droppedFields: drops });
    expect(parsed.droppedFields).toEqual(drops);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe('created');
  });

  it('the element is the engine\'s DroppedFieldsEventSchema itself — no second vocabulary', () => {
    const element = ImportRowResultSchema.shape.droppedFields.unwrap().element;
    expect(element).toBe(DroppedFieldsEventSchema);
  });

  it('accepts exactly the engine\'s reason set, `computed` included', () => {
    const engineReasons = DroppedFieldsEventSchema.shape.reason.options;
    expect(engineReasons).toContain('computed');
    for (const reason of engineReasons) {
      const parsed = ImportRowResultSchema.parse({
        ...okRow, droppedFields: [{ object: 'project', fields: ['f'], reason }],
      });
      expect(parsed.droppedFields?.[0]?.reason, `reason ${reason}`).toBe(reason);
    }
    const outside = ImportRowResultSchema.safeParse({
      ...okRow, droppedFields: [{ object: 'project', fields: ['f'], reason: 'not_a_reason' }],
    });
    expect(outside.success).toBe(false);
    const issue = outside.success ? undefined : outside.error.issues[0];
    expect(issue?.code).toBe('invalid_value');
    expect(issue?.path).toEqual(['droppedFields', 0, 'reason']);
  });

  it('keeps the served dry-run warnings, in the validate verdict\'s issue shape', () => {
    const warnings = [{ field: 'billing_address', code: 'invalid_type', message: 'billing_address has an invalid value' }];
    const parsed = ImportRowResultSchema.parse({ ...okRow, warnings });
    expect(parsed.warnings).toEqual(warnings);
    const partial = ImportRowResultSchema.safeParse({ ...okRow, warnings: [{ field: 'x', code: 'y' }] });
    expect(partial.success).toBe(false);
    const issue = partial.success ? undefined : partial.error.issues[0];
    expect(issue?.path).toEqual(['warnings', 0, 'message']);
  });

  it('the async job sample carries the same row keys', () => {
    const parsed = ImportJobResultsSchema.parse({
      jobId: 'imp_1', object: 'project', status: 'succeeded', dryRun: false, writeMode: 'insert',
      total: 1, processed: 1, created: 1, updated: 0, skipped: 0, errors: 0, percentComplete: 100,
      undoable: true, createdAt: '2026-09-30T00:00:00.000Z',
      results: [{ ...okRow, droppedFields: drops }], resultsTruncated: false,
    });
    expect(parsed.results[0]?.droppedFields).toEqual(drops);
    const described = (ImportJobResultsSchema.shape.results as { description?: string }).description ?? '';
    expect(described).toMatch(/failures first/);
    expect(described).toMatch(/inside the sample/);
  });

  it('the typed reader sees both keys, in the engine\'s and the verdict\'s types', () => {
    expectTypeOf<NonNullable<ImportRowResult['droppedFields']>[number]>().toEqualTypeOf<DroppedFieldsEvent>();
    expectTypeOf<NonNullable<ImportRowResult['warnings']>[number]>().toEqualTypeOf<ValidateDataIssue>();
  });
});
