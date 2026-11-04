import { describe, it, expect } from 'vitest';
import {
  ReferenceResolutionSchema,
  ObjectDependencyNodeSchema,
  ObjectDependencyGraphSchema,
  ReferenceResolutionErrorSchema,
  SeedLoaderConfigSchema,
  SeedLoadResultSchema,
  SeedLoaderResultSchema,
  SeedLoaderRequestSchema,
} from './seed-loader.zod';
import { SeedSchema } from './seed.zod';

// ==========================================================================
// ReferenceResolutionSchema
// ==========================================================================

describe('ReferenceResolutionSchema', () => {
  it('should accept a valid lookup reference', () => {
    const ref = {
      field: 'account_id',
      targetObject: 'account',
      targetField: 'name',
      fieldType: 'lookup' as const,
    };
    const parsed = ReferenceResolutionSchema.parse(ref);
    expect(parsed.field).toBe('account_id');
    expect(parsed.targetObject).toBe('account');
    expect(parsed.fieldType).toBe('lookup');
  });

  it('should accept a master_detail reference', () => {
    const ref = {
      field: 'environment_id',
      targetObject: 'project',
      fieldType: 'master_detail' as const,
    };
    const parsed = ReferenceResolutionSchema.parse(ref);
    expect(parsed.targetField).toBe('name'); // default
    expect(parsed.fieldType).toBe('master_detail');
  });

  it('should default targetField to name', () => {
    const ref = ReferenceResolutionSchema.parse({
      field: 'owner',
      targetObject: 'user',
      fieldType: 'lookup',
    });
    expect(ref.targetField).toBe('name');
  });

  it('should reject invalid target object name', () => {
    expect(() => ReferenceResolutionSchema.parse({
      field: 'account_id',
      targetObject: 'InvalidName',
      fieldType: 'lookup',
    })).toThrow();
  });

  it('should reject invalid field type', () => {
    expect(() => ReferenceResolutionSchema.parse({
      field: 'account_id',
      targetObject: 'account',
      fieldType: 'foreign_key',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ReferenceResolutionSchema.parse({})).toThrow();
    expect(() => ReferenceResolutionSchema.parse({ field: 'x' })).toThrow();
  });
});

// ==========================================================================
// ObjectDependencyNodeSchema
// ==========================================================================

describe('ObjectDependencyNodeSchema', () => {
  it('should accept an object with no dependencies', () => {
    const node = ObjectDependencyNodeSchema.parse({
      object: 'country',
      dependsOn: [],
      references: [],
    });
    expect(node.dependsOn).toHaveLength(0);
  });

  it('should accept an object with dependencies', () => {
    const node = ObjectDependencyNodeSchema.parse({
      object: 'contact',
      dependsOn: ['account', 'user'],
      references: [
        { field: 'account_id', targetObject: 'account', fieldType: 'lookup' },
        { field: 'owner', targetObject: 'user', fieldType: 'lookup' },
      ],
    });
    expect(node.dependsOn).toEqual(['account', 'user']);
    expect(node.references).toHaveLength(2);
  });

  it('should reject invalid object name', () => {
    expect(() => ObjectDependencyNodeSchema.parse({
      object: 'Invalid',
      dependsOn: [],
      references: [],
    })).toThrow();
  });
});

// ==========================================================================
// ObjectDependencyGraphSchema
// ==========================================================================

describe('ObjectDependencyGraphSchema', () => {
  it('should accept a simple linear dependency graph', () => {
    const graph = ObjectDependencyGraphSchema.parse({
      nodes: [
        { object: 'country', dependsOn: [], references: [] },
        { object: 'account', dependsOn: ['country'], references: [
          { field: 'country_id', targetObject: 'country', fieldType: 'lookup' },
        ]},
        { object: 'contact', dependsOn: ['account'], references: [
          { field: 'account_id', targetObject: 'account', fieldType: 'master_detail' },
        ]},
      ],
      insertOrder: ['country', 'account', 'contact'],
    });
    expect(graph.insertOrder).toEqual(['country', 'account', 'contact']);
    expect(graph.circularDependencies).toEqual([]);
  });

  it('should accept a graph with circular dependencies', () => {
    const graph = ObjectDependencyGraphSchema.parse({
      nodes: [
        { object: 'project', dependsOn: ['task'], references: [
          { field: 'lead_task', targetObject: 'task', fieldType: 'lookup' },
        ]},
        { object: 'task', dependsOn: ['project'], references: [
          { field: 'environment_id', targetObject: 'project', fieldType: 'master_detail' },
        ]},
      ],
      insertOrder: ['project', 'task'],
      circularDependencies: [['project', 'task', 'project']],
    });
    expect(graph.circularDependencies).toHaveLength(1);
  });

  it('should default circularDependencies to empty array', () => {
    const graph = ObjectDependencyGraphSchema.parse({
      nodes: [],
      insertOrder: [],
    });
    expect(graph.circularDependencies).toEqual([]);
  });
});

// ==========================================================================
// ReferenceResolutionErrorSchema
// ==========================================================================

describe('ReferenceResolutionErrorSchema', () => {
  it('should accept a complete resolution error', () => {
    const error = ReferenceResolutionErrorSchema.parse({
      sourceObject: 'contact',
      field: 'account_id',
      targetObject: 'account',
      targetField: 'name',
      attemptedValue: 'Nonexistent Corp',
      recordIndex: 3,
      message: 'No account found with name "Nonexistent Corp". Check that the referenced record exists in the account object.',
    });
    expect(error.sourceObject).toBe('contact');
    expect(error.attemptedValue).toBe('Nonexistent Corp');
    expect(error.recordIndex).toBe(3);
  });

  it('should accept numeric attempted values', () => {
    const error = ReferenceResolutionErrorSchema.parse({
      sourceObject: 'order_item',
      field: 'product_id',
      targetObject: 'product',
      targetField: 'code',
      attemptedValue: 12345,
      recordIndex: 0,
      message: 'No product found with code "12345"',
    });
    expect(error.attemptedValue).toBe(12345);
  });

  it('should reject negative record index', () => {
    expect(() => ReferenceResolutionErrorSchema.parse({
      sourceObject: 'contact',
      field: 'account_id',
      targetObject: 'account',
      targetField: 'name',
      attemptedValue: 'test',
      recordIndex: -1,
      message: 'error',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ReferenceResolutionErrorSchema.parse({})).toThrow();
    expect(() => ReferenceResolutionErrorSchema.parse({
      sourceObject: 'contact',
    })).toThrow();
  });
});

// ==========================================================================
// SeedLoaderConfigSchema
// ==========================================================================

describe('SeedLoaderConfigSchema', () => {
  it('should apply all defaults', () => {
    const config = SeedLoaderConfigSchema.parse({});
    expect(config.dryRun).toBe(false);
    expect(config.haltOnError).toBe(false);
    expect(config.multiPass).toBe(true);
    expect(config.defaultMode).toBe('ignore');
    expect(config.batchSize).toBe(1000);
    expect(config.transaction).toBe(false);
    expect(config.env).toBeUndefined();
  });

  it('takes its defaultMode from the seed mode default — one default, stated once (#30081)', () => {
    const seedDefault = SeedSchema.parse({ object: 'product', records: [] }).mode;
    expect(SeedLoaderConfigSchema.parse({}).defaultMode).toBe(seedDefault);
  });

  it('should accept dry-run configuration', () => {
    const config = SeedLoaderConfigSchema.parse({
      dryRun: true,
      haltOnError: true,
    });
    expect(config.dryRun).toBe(true);
    expect(config.haltOnError).toBe(true);
  });

  it('should accept environment filter', () => {
    const config = SeedLoaderConfigSchema.parse({ env: 'dev' });
    expect(config.env).toBe('dev');
  });

  it('should accept custom batch size', () => {
    const config = SeedLoaderConfigSchema.parse({ batchSize: 500 });
    expect(config.batchSize).toBe(500);
  });

  it('should accept transaction mode', () => {
    const config = SeedLoaderConfigSchema.parse({ transaction: true });
    expect(config.transaction).toBe(true);
  });

  it('should reject invalid environment', () => {
    expect(() => SeedLoaderConfigSchema.parse({ env: 'staging' })).toThrow();
  });

  it('should reject batch size less than 1', () => {
    expect(() => SeedLoaderConfigSchema.parse({ batchSize: 0 })).toThrow();
  });

  it('should accept all valid dataset modes as default', () => {
    const modes = ['insert', 'update', 'upsert', 'replace', 'ignore'] as const;
    modes.forEach(mode => {
      const config = SeedLoaderConfigSchema.parse({ defaultMode: mode });
      expect(config.defaultMode).toBe(mode);
    });
  });

  it('should accept multiPass disabled', () => {
    const config = SeedLoaderConfigSchema.parse({ multiPass: false });
    expect(config.multiPass).toBe(false);
  });
});

// ==========================================================================
// SeedLoadResultSchema
// ==========================================================================

describe('SeedLoadResultSchema', () => {
  it('should accept a successful load result', () => {
    const result = SeedLoadResultSchema.parse({
      object: 'account',
      mode: 'upsert',
      inserted: 5,
      updated: 2,
      skipped: 0,
      errored: 0,
      total: 7,
      referencesResolved: 3,
      referencesDeferred: 0,
    });
    expect(result.inserted).toBe(5);
    expect(result.updated).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('should accept a result with errors', () => {
    const result = SeedLoadResultSchema.parse({
      object: 'contact',
      mode: 'upsert',
      inserted: 3,
      updated: 0,
      skipped: 0,
      errored: 2,
      total: 5,
      referencesResolved: 1,
      referencesDeferred: 0,
      errors: [
        {
          sourceObject: 'contact',
          field: 'account_id',
          targetObject: 'account',
          targetField: 'name',
          attemptedValue: 'Missing Corp',
          recordIndex: 2,
          message: 'No account found with name "Missing Corp"',
        },
      ],
    });
    expect(result.errored).toBe(2);
    expect(result.errors).toHaveLength(1);
  });

  it('should accept a result with deferred references', () => {
    const result = SeedLoadResultSchema.parse({
      object: 'task',
      mode: 'insert',
      inserted: 10,
      updated: 0,
      skipped: 0,
      errored: 0,
      total: 10,
      referencesResolved: 5,
      referencesDeferred: 3,
    });
    expect(result.referencesDeferred).toBe(3);
  });

  it('should default errors to empty array', () => {
    const result = SeedLoadResultSchema.parse({
      object: 'product',
      mode: 'insert',
      inserted: 1,
      updated: 0,
      skipped: 0,
      errored: 0,
      total: 1,
      referencesResolved: 0,
      referencesDeferred: 0,
    });
    expect(result.errors).toEqual([]);
  });

  it('should reject negative counts', () => {
    expect(() => SeedLoadResultSchema.parse({
      object: 'test',
      mode: 'upsert',
      inserted: -1,
      updated: 0,
      skipped: 0,
      errored: 0,
      total: 0,
      referencesResolved: 0,
      referencesDeferred: 0,
    })).toThrow();
  });
});

// ==========================================================================
// SeedLoaderResultSchema
// ==========================================================================

describe('SeedLoaderResultSchema', () => {
  it('should accept a successful seed loader result', () => {
    const result = SeedLoaderResultSchema.parse({
      success: true,
      dryRun: false,
      dependencyGraph: {
        nodes: [
          { object: 'country', dependsOn: [], references: [] },
          { object: 'account', dependsOn: ['country'], references: [
            { field: 'country_id', targetObject: 'country', fieldType: 'lookup' },
          ]},
        ],
        insertOrder: ['country', 'account'],
      },
      results: [
        {
          object: 'country',
          mode: 'upsert',
          inserted: 3,
          updated: 0,
          skipped: 0,
          errored: 0,
          total: 3,
          referencesResolved: 0,
          referencesDeferred: 0,
        },
        {
          object: 'account',
          mode: 'upsert',
          inserted: 5,
          updated: 0,
          skipped: 0,
          errored: 0,
          total: 5,
          referencesResolved: 5,
          referencesDeferred: 0,
        },
      ],
      errors: [],
      summary: {
        objectsProcessed: 2,
        totalRecords: 8,
        totalInserted: 8,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 5,
        totalReferencesDeferred: 0,
        circularDependencyCount: 0,
        durationMs: 150,
      },
    });
    expect(result.success).toBe(true);
    expect(result.summary.objectsProcessed).toBe(2);
    expect(result.summary.totalReferencesResolved).toBe(5);
  });

  it('should accept a dry-run result', () => {
    const result = SeedLoaderResultSchema.parse({
      success: true,
      dryRun: true,
      dependencyGraph: {
        nodes: [],
        insertOrder: [],
      },
      results: [],
      errors: [],
      summary: {
        objectsProcessed: 0,
        totalRecords: 0,
        totalInserted: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 0,
        totalReferencesDeferred: 0,
        circularDependencyCount: 0,
        durationMs: 10,
      },
    });
    expect(result.dryRun).toBe(true);
  });

  it('should accept a result with errors', () => {
    const result = SeedLoaderResultSchema.parse({
      success: false,
      dryRun: false,
      dependencyGraph: {
        nodes: [{ object: 'contact', dependsOn: ['account'], references: [
          { field: 'account_id', targetObject: 'account', fieldType: 'lookup' },
        ]}],
        insertOrder: ['account', 'contact'],
      },
      results: [{
        object: 'contact',
        mode: 'upsert',
        inserted: 0,
        updated: 0,
        skipped: 0,
        errored: 1,
        total: 1,
        referencesResolved: 0,
        referencesDeferred: 0,
        errors: [{
          sourceObject: 'contact',
          field: 'account_id',
          targetObject: 'account',
          targetField: 'name',
          attemptedValue: 'Ghost Corp',
          recordIndex: 0,
          message: 'No account found with name "Ghost Corp"',
        }],
      }],
      errors: [{
        sourceObject: 'contact',
        field: 'account_id',
        targetObject: 'account',
        targetField: 'name',
        attemptedValue: 'Ghost Corp',
        recordIndex: 0,
        message: 'No account found with name "Ghost Corp"',
      }],
      summary: {
        objectsProcessed: 1,
        totalRecords: 1,
        totalInserted: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 1,
        totalReferencesResolved: 0,
        totalReferencesDeferred: 0,
        circularDependencyCount: 0,
        durationMs: 50,
      },
    });
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].attemptedValue).toBe('Ghost Corp');
  });

  it('should accept a result with circular dependencies', () => {
    const result = SeedLoaderResultSchema.parse({
      success: true,
      dryRun: false,
      dependencyGraph: {
        nodes: [
          { object: 'project', dependsOn: ['task'], references: [
            { field: 'lead_task', targetObject: 'task', fieldType: 'lookup' },
          ]},
          { object: 'task', dependsOn: ['project'], references: [
            { field: 'environment_id', targetObject: 'project', fieldType: 'master_detail' },
          ]},
        ],
        insertOrder: ['project', 'task'],
        circularDependencies: [['project', 'task', 'project']],
      },
      results: [
        {
          object: 'project',
          mode: 'upsert',
          inserted: 2,
          updated: 0,
          skipped: 0,
          errored: 0,
          total: 2,
          referencesResolved: 0,
          referencesDeferred: 2,
        },
        {
          object: 'task',
          mode: 'upsert',
          inserted: 5,
          updated: 0,
          skipped: 0,
          errored: 0,
          total: 5,
          referencesResolved: 5,
          referencesDeferred: 0,
        },
      ],
      errors: [],
      summary: {
        objectsProcessed: 2,
        totalRecords: 7,
        totalInserted: 7,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 5,
        totalReferencesDeferred: 2,
        circularDependencyCount: 1,
        durationMs: 200,
      },
    });
    expect(result.summary.circularDependencyCount).toBe(1);
    expect(result.summary.totalReferencesDeferred).toBe(2);
  });

  it('should reject missing required fields', () => {
    expect(() => SeedLoaderResultSchema.parse({})).toThrow();
  });
});

// ==========================================================================
// SeedLoaderRequestSchema
// ==========================================================================

describe('SeedLoaderRequestSchema', () => {
  it('should accept a minimal request with defaults', () => {
    const request = SeedLoaderRequestSchema.parse({
      seeds: [
        { object: 'country', records: [{ name: 'United States', code: 'US' }] },
      ],
    });
    expect(request.seeds).toHaveLength(1);
    expect(request.config.dryRun).toBe(false);
    expect(request.config.defaultMode).toBe('ignore');
    // Each dataset is parsed through SeedSchema, so a mode-less dataset
    // reaches the loader already carrying the create-only default.
    expect(request.seeds[0].mode).toBe('ignore');
  });

  it('should accept a request with full configuration', () => {
    const request = SeedLoaderRequestSchema.parse({
      seeds: [
        {
          object: 'account',
          externalId: 'code',
          mode: 'upsert',
          records: [{ code: 'ACC001', name: 'Acme Corp' }],
        },
        {
          object: 'contact',
          records: [{ name: 'John Doe', account_id: 'Acme Corp' }],
        },
      ],
      config: {
        dryRun: true,
        haltOnError: true,
        multiPass: true,
        batchSize: 500,
        env: 'dev',
      },
    });
    expect(request.seeds).toHaveLength(2);
    expect(request.config.dryRun).toBe(true);
    expect(request.config.env).toBe('dev');
  });

  it('should reject empty datasets', () => {
    expect(() => SeedLoaderRequestSchema.parse({
      seeds: [],
    })).toThrow();
  });

  it('should reject request without datasets', () => {
    expect(() => SeedLoaderRequestSchema.parse({})).toThrow();
  });

  it('should handle CRM seed data scenario', () => {
    const request = SeedLoaderRequestSchema.parse({
      seeds: [
        {
          object: 'industry',
          externalId: 'code',
          mode: 'upsert',
          records: [
            { code: 'tech', name: 'Technology' },
            { code: 'finance', name: 'Finance' },
          ],
        },
        {
          object: 'account',
          externalId: 'name',
          mode: 'upsert',
          records: [
            { name: 'Acme Corp', industry: 'tech' },
            { name: 'Beta Inc', industry: 'finance' },
          ],
        },
        {
          object: 'contact',
          externalId: 'email',
          mode: 'upsert',
          records: [
            { email: 'john@acme.com', name: 'John', account_id: 'Acme Corp' },
            { email: 'jane@beta.com', name: 'Jane', account_id: 'Beta Inc' },
          ],
        },
      ],
      config: {
        multiPass: true,
        defaultMode: 'upsert',
      },
    });
    expect(request.seeds).toHaveLength(3);
    expect(request.seeds[0].externalId).toBe('code');
    expect(request.seeds[2].externalId).toBe('email');
  });
});
