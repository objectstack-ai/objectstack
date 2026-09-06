import { describe, it, expect } from 'vitest';
import {
  TenantSchema,
  TenantIsolationLevel,
  TenantQuotaSchema,
  RowLevelIsolationStrategySchema,
  SchemaLevelIsolationStrategySchema,
  DatabaseLevelIsolationStrategySchema,
  TenantIsolationConfigSchema,
  TenantSecurityPolicySchema,
  DatabaseProviderSchema,
  TenantConnectionConfigSchema,
  TenantUsageSchema,
  QuotaEnforcementResultSchema,
  type Tenant,
  type TenantQuota,
  type RowLevelIsolationStrategy,
  type SchemaLevelIsolationStrategy,
  type DatabaseLevelIsolationStrategy,
  type TenantIsolationConfig,
  type TenantSecurityPolicy,
  type DatabaseProvider,
  type TenantConnectionConfig,
  type TenantUsage,
  type QuotaEnforcementResult,
} from './tenant.zod';

describe('TenantIsolationLevel', () => {
  it('should accept valid isolation levels', () => {
    const levels = ['shared_schema', 'isolated_schema', 'isolated_db'];

    levels.forEach((level) => {
      expect(() => TenantIsolationLevel.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid isolation levels', () => {
    expect(() => TenantIsolationLevel.parse('invalid')).toThrow();
    expect(() => TenantIsolationLevel.parse('sharedSchema')).toThrow();
  });
});

describe('TenantQuotaSchema', () => {
  it('should accept valid quota configuration', () => {
    const validQuota: TenantQuota = {
      maxUsers: 100,
      maxStorage: 10737418240, // 10GB in bytes
      apiRateLimit: 1000,
    };

    expect(() => TenantQuotaSchema.parse(validQuota)).not.toThrow();
  });

  it('should accept partial quota configuration', () => {
    const partialQuota = {
      maxUsers: 50,
    };

    expect(() => TenantQuotaSchema.parse(partialQuota)).not.toThrow();
  });

  it('should accept empty quota configuration', () => {
    const emptyQuota = {};

    expect(() => TenantQuotaSchema.parse(emptyQuota)).not.toThrow();
  });

  it('should reject negative values', () => {
    const invalidQuota = {
      maxUsers: -10,
    };

    expect(() => TenantQuotaSchema.parse(invalidQuota)).toThrow();
  });

  it('should reject non-integer values', () => {
    const invalidQuota = {
      maxUsers: 10.5,
    };

    expect(() => TenantQuotaSchema.parse(invalidQuota)).toThrow();
  });
});

describe('TenantSchema', () => {
  it('should accept valid tenant configuration', () => {
    const validTenant: Tenant = {
      id: 'tenant_123',
      name: 'Acme Corporation',
      isolationLevel: 'isolated_schema',
      customizations: {
        theme: 'dark',
        logo: 'https://example.com/logo.png',
      },
      quotas: {
        maxUsers: 100,
        maxStorage: 10737418240,
        apiRateLimit: 1000,
      },
    };

    expect(() => TenantSchema.parse(validTenant)).not.toThrow();
  });

  it('should accept minimal tenant configuration', () => {
    const minimalTenant = {
      id: 'tenant_456',
      name: 'Basic Tenant',
      isolationLevel: 'shared_schema',
    };

    expect(() => TenantSchema.parse(minimalTenant)).not.toThrow();
  });

  it('should accept tenant with customizations but no quotas', () => {
    const tenant = {
      id: 'tenant_789',
      name: 'Custom Tenant',
      isolationLevel: 'isolated_db',
      customizations: {
        feature_flags: {
          advanced_analytics: true,
          api_access: true,
        },
      },
    };

    expect(() => TenantSchema.parse(tenant)).not.toThrow();
  });

  it('should accept tenant with quotas but no customizations', () => {
    const tenant = {
      id: 'tenant_101',
      name: 'Quota Tenant',
      isolationLevel: 'shared_schema',
      quotas: {
        maxUsers: 50,
        apiRateLimit: 500,
      },
    };

    expect(() => TenantSchema.parse(tenant)).not.toThrow();
  });

  it('should require id field', () => {
    const invalidTenant = {
      name: 'Missing ID Tenant',
      isolationLevel: 'shared_schema',
    };

    expect(() => TenantSchema.parse(invalidTenant)).toThrow();
  });

  it('should require name field', () => {
    const invalidTenant = {
      id: 'tenant_202',
      isolationLevel: 'shared_schema',
    };

    expect(() => TenantSchema.parse(invalidTenant)).toThrow();
  });

  it('should require isolationLevel field', () => {
    const invalidTenant = {
      id: 'tenant_303',
      name: 'Missing Isolation Tenant',
    };

    expect(() => TenantSchema.parse(invalidTenant)).toThrow();
  });

  it('should reject invalid isolationLevel', () => {
    const invalidTenant = {
      id: 'tenant_404',
      name: 'Invalid Isolation Tenant',
      isolationLevel: 'wrong_level',
    };

    expect(() => TenantSchema.parse(invalidTenant)).toThrow();
  });

  it('should allow arbitrary customization values', () => {
    const tenant = {
      id: 'tenant_505',
      name: 'Flexible Customizations',
      isolationLevel: 'shared_schema',
      customizations: {
        string_value: 'text',
        number_value: 42,
        boolean_value: true,
        array_value: [1, 2, 3],
        nested_object: {
          deep: {
            property: 'value',
          },
        },
      },
    };

    expect(() => TenantSchema.parse(tenant)).not.toThrow();
  });
});

describe('RowLevelIsolationStrategySchema', () => {
  it('should accept valid row-level isolation configuration', () => {
    const validConfig: RowLevelIsolationStrategy = {
      strategy: 'shared_schema',
      database: {
        enableRLS: true,
        contextMethod: 'session_variable',
        contextVariable: 'app.current_tenant',
        applicationValidation: true,
      },
      performance: {
        usePartialIndexes: true,
        usePartitioning: false,
        poolSizePerTenant: 5,
      },
    };

    expect(() => RowLevelIsolationStrategySchema.parse(validConfig)).not.toThrow();
  });

  it('should accept minimal row-level isolation configuration', () => {
    const minimalConfig = {
      strategy: 'shared_schema',
    };

    expect(() => RowLevelIsolationStrategySchema.parse(minimalConfig)).not.toThrow();
  });

  it('should default enableRLS to true', () => {
    const config = {
      strategy: 'shared_schema',
      database: {},
    };

    const parsed = RowLevelIsolationStrategySchema.parse(config);
    expect(parsed.database?.enableRLS).toBe(true);
  });

  it('should accept different context methods', () => {
    const methods = ['session_variable', 'search_path', 'application_name'];

    methods.forEach((method) => {
      const config = {
        strategy: 'shared_schema',
        database: {
          contextMethod: method,
        },
      };
      expect(() => RowLevelIsolationStrategySchema.parse(config)).not.toThrow();
    });
  });
});

describe('SchemaLevelIsolationStrategySchema', () => {
  it('should accept valid schema-level isolation configuration', () => {
    const validConfig: SchemaLevelIsolationStrategy = {
      strategy: 'isolated_schema',
      schema: {
        namingPattern: 'tenant_{tenant_id}',
        includePublicSchema: true,
        sharedSchema: 'public',
        autoCreateSchema: true,
      },
      migrations: {
        strategy: 'parallel',
        maxConcurrent: 10,
        rollbackOnError: true,
      },
      performance: {
        poolPerSchema: false,
        schemaCacheTTL: 3600,
      },
    };

    expect(() => SchemaLevelIsolationStrategySchema.parse(validConfig)).not.toThrow();
  });

  it('should accept minimal schema-level isolation configuration', () => {
    const minimalConfig = {
      strategy: 'isolated_schema',
    };

    expect(() => SchemaLevelIsolationStrategySchema.parse(minimalConfig)).not.toThrow();
  });

  it('should default schema naming pattern', () => {
    const config = {
      strategy: 'isolated_schema',
      schema: {},
    };

    const parsed = SchemaLevelIsolationStrategySchema.parse(config);
    expect(parsed.schema?.namingPattern).toBe('tenant_{tenant_id}');
  });

  it('should accept different migration strategies', () => {
    const strategies = ['parallel', 'sequential', 'on_demand'];

    strategies.forEach((strategy) => {
      const config = {
        strategy: 'isolated_schema',
        migrations: {
          strategy,
        },
      };
      expect(() => SchemaLevelIsolationStrategySchema.parse(config)).not.toThrow();
    });
  });
});

describe('DatabaseLevelIsolationStrategySchema', () => {
  it('should accept valid database-level isolation configuration', () => {
    const validConfig: DatabaseLevelIsolationStrategy = {
      strategy: 'isolated_db',
      database: {
        namingPattern: 'tenant_{tenant_id}',
        serverStrategy: 'shared',
        separateCredentials: true,
        autoCreateDatabase: true,
      },
      connectionPool: {
        poolSize: 10,
        maxActivePools: 100,
        idleTimeoutSeconds: 300,
        usePooler: true,
      },
      backup: {
        strategy: 'individual',
        frequencyHours: 24,
        retentionDays: 30,
      },
      encryption: {
        perTenantKeys: true,
        algorithm: 'AES-256-GCM',
        keyManagement: 'aws_kms',
      },
    };

    expect(() => DatabaseLevelIsolationStrategySchema.parse(validConfig)).not.toThrow();
  });

  it('should accept minimal database-level isolation configuration', () => {
    const minimalConfig = {
      strategy: 'isolated_db',
    };

    expect(() => DatabaseLevelIsolationStrategySchema.parse(minimalConfig)).not.toThrow();
  });

  it('should default database naming pattern', () => {
    const config = {
      strategy: 'isolated_db',
      database: {},
    };

    const parsed = DatabaseLevelIsolationStrategySchema.parse(config);
    expect(parsed.database?.namingPattern).toBe('tenant_{tenant_id}');
  });

  it('should accept different server strategies', () => {
    const strategies = ['shared', 'sharded', 'dedicated'];

    strategies.forEach((serverStrategy) => {
      const config = {
        strategy: 'isolated_db',
        database: {
          serverStrategy,
        },
      };
      expect(() => DatabaseLevelIsolationStrategySchema.parse(config)).not.toThrow();
    });
  });

  it('should accept different backup strategies', () => {
    const strategies = ['individual', 'consolidated', 'on_demand'];

    strategies.forEach((strategy) => {
      const config = {
        strategy: 'isolated_db',
        backup: {
          strategy,
        },
      };
      expect(() => DatabaseLevelIsolationStrategySchema.parse(config)).not.toThrow();
    });
  });
});

describe('TenantIsolationConfigSchema', () => {
  it('should accept row-level isolation config', () => {
    const config: TenantIsolationConfig = {
      strategy: 'shared_schema',
      database: {
        enableRLS: true,
      },
    };

    expect(() => TenantIsolationConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept schema-level isolation config', () => {
    const config: TenantIsolationConfig = {
      strategy: 'isolated_schema',
      schema: {
        namingPattern: 'tenant_{tenant_id}',
      },
    };

    expect(() => TenantIsolationConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept database-level isolation config', () => {
    const config: TenantIsolationConfig = {
      strategy: 'isolated_db',
      database: {
        serverStrategy: 'dedicated',
      },
    };

    expect(() => TenantIsolationConfigSchema.parse(config)).not.toThrow();
  });

  it('should discriminate by strategy field', () => {
    const configs = [
      { strategy: 'shared_schema' },
      { strategy: 'isolated_schema' },
      { strategy: 'isolated_db' },
    ];

    configs.forEach((config) => {
      expect(() => TenantIsolationConfigSchema.parse(config)).not.toThrow();
    });
  });
});

describe('TenantSecurityPolicySchema', () => {
  it('should accept complete security policy', () => {
    const validPolicy: TenantSecurityPolicy = {
      encryption: {
        atRest: true,
        inTransit: true,
        fieldLevel: true,
      },
      accessControl: {
        requireMFA: true,
        requireSSO: true,
        ipWhitelist: ['192.168.1.0/24', '10.0.0.0/8'],
        sessionTimeoutSeconds: 3600,
      },
      compliance: {
        standards: ['sox', 'hipaa', 'gdpr'],
        requireAuditLog: true,
        auditRetentionDays: 365,
        dataResidency: {
          region: 'US',
          excludeRegions: ['CN', 'RU'],
        },
      },
    };

    expect(() => TenantSecurityPolicySchema.parse(validPolicy)).not.toThrow();
  });

  it('should accept minimal security policy', () => {
    const minimalPolicy = {};
    expect(() => TenantSecurityPolicySchema.parse(minimalPolicy)).not.toThrow();
  });

  it('should default encryption settings', () => {
    const policy = {
      encryption: {},
    };

    const parsed = TenantSecurityPolicySchema.parse(policy);
    expect(parsed.encryption?.atRest).toBe(true);
    expect(parsed.encryption?.inTransit).toBe(true);
    expect(parsed.encryption?.fieldLevel).toBe(false);
  });

  it('should default access control settings', () => {
    const policy = {
      accessControl: {},
    };

    const parsed = TenantSecurityPolicySchema.parse(policy);
    expect(parsed.accessControl?.requireMFA).toBe(false);
    expect(parsed.accessControl?.requireSSO).toBe(false);
    expect(parsed.accessControl?.sessionTimeoutSeconds).toBe(3600);
  });

  it('should accept compliance standards', () => {
    const standards = ['sox', 'hipaa', 'gdpr', 'pci_dss', 'iso_27001', 'fedramp'];

    const policy = {
      compliance: {
        standards,
      },
    };

    expect(() => TenantSecurityPolicySchema.parse(policy)).not.toThrow();
  });

  it('should default compliance settings', () => {
    const policy = {
      compliance: {},
    };

    const parsed = TenantSecurityPolicySchema.parse(policy);
    expect(parsed.compliance?.requireAuditLog).toBe(true);
    expect(parsed.compliance?.auditRetentionDays).toBe(365);
  });
});

describe('DatabaseProviderSchema', () => {
  it('should accept valid database providers', () => {
    const providers: DatabaseProvider[] = ['turso', 'postgres', 'memory'];
    providers.forEach((p) => {
      expect(() => DatabaseProviderSchema.parse(p)).not.toThrow();
    });
  });

  it('should reject invalid database provider', () => {
    expect(() => DatabaseProviderSchema.parse('mysql')).toThrow();
    expect(() => DatabaseProviderSchema.parse('sqlite')).toThrow();
  });
});

describe('TenantConnectionConfigSchema', () => {
  it('should accept full connection config', () => {
    const config: TenantConnectionConfig = {
      url: 'libsql://tenant-abc-myorg.turso.io',
      authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...',
      group: 'production',
    };
    const parsed = TenantConnectionConfigSchema.parse(config);
    expect(parsed.url).toBe('libsql://tenant-abc-myorg.turso.io');
    expect(parsed.authToken).toBeDefined();
    expect(parsed.group).toBe('production');
  });

  it('should accept minimal connection config (url only)', () => {
    const config = { url: 'file:local.db' };
    const parsed = TenantConnectionConfigSchema.parse(config);
    expect(parsed.url).toBe('file:local.db');
    expect(parsed.authToken).toBeUndefined();
    expect(parsed.group).toBeUndefined();
  });

  it('should reject missing url', () => {
    expect(() => TenantConnectionConfigSchema.parse({})).toThrow();
  });

  it('should reject empty url', () => {
    expect(() => TenantConnectionConfigSchema.parse({ url: '' })).toThrow();
  });
});

describe('TenantSchema (extended fields)', () => {
  it('should accept tenant with Turso provisioning fields', () => {
    const tenant = {
      id: 'tenant_turso_001',
      name: 'Turso Tenant',
      isolationLevel: 'isolated_db',
      databaseProvider: 'turso',
      connectionConfig: {
        url: 'libsql://tenant-001-myorg.turso.io',
        authToken: 'jwt-token',
        group: 'production',
      },
      provisioningStatus: 'active',
      plan: 'pro',
    };
    const parsed = TenantSchema.parse(tenant);
    expect(parsed.databaseProvider).toBe('turso');
    expect(parsed.connectionConfig?.url).toContain('turso.io');
    expect(parsed.provisioningStatus).toBe('active');
    expect(parsed.plan).toBe('pro');
  });

  it('should accept all provisioning statuses', () => {
    const statuses = ['provisioning', 'active', 'suspended', 'failed', 'destroying'];
    statuses.forEach((status) => {
      const tenant = {
        id: 'tenant_status',
        name: 'Status Test',
        isolationLevel: 'isolated_db',
        provisioningStatus: status,
      };
      expect(() => TenantSchema.parse(tenant)).not.toThrow();
    });
  });

  it('should accept all plan values', () => {
    const plans = ['free', 'pro', 'enterprise'];
    plans.forEach((plan) => {
      const tenant = {
        id: 'tenant_plan',
        name: 'Plan Test',
        isolationLevel: 'isolated_db',
        plan,
      };
      expect(() => TenantSchema.parse(tenant)).not.toThrow();
    });
  });

  it('should remain backward-compatible (new fields are optional)', () => {
    const legacyTenant = {
      id: 'tenant_legacy',
      name: 'Legacy Tenant',
      isolationLevel: 'shared_schema',
    };
    const parsed = TenantSchema.parse(legacyTenant);
    expect(parsed.databaseProvider).toBeUndefined();
    expect(parsed.connectionConfig).toBeUndefined();
    expect(parsed.provisioningStatus).toBeUndefined();
    expect(parsed.plan).toBeUndefined();
  });
});

describe('TenantQuotaSchema (extended fields)', () => {
  it('should accept extended quota fields', () => {
    const quota: TenantQuota = {
      maxUsers: 100,
      maxStorage: 10737418240,
      apiRateLimit: 1000,
      maxObjects: 50,
      maxRecordsPerObject: 100000,
      maxDeploymentsPerDay: 10,
      maxStorageBytes: 5368709120,
    };
    const parsed = TenantQuotaSchema.parse(quota);
    expect(parsed.maxObjects).toBe(50);
    expect(parsed.maxRecordsPerObject).toBe(100000);
    expect(parsed.maxDeploymentsPerDay).toBe(10);
    expect(parsed.maxStorageBytes).toBe(5368709120);
  });

  it('should accept empty quota (all optional)', () => {
    const parsed = TenantQuotaSchema.parse({});
    expect(parsed.maxObjects).toBeUndefined();
    expect(parsed.maxRecordsPerObject).toBeUndefined();
  });
});

describe('TenantUsageSchema', () => {
  it('should accept full usage tracking', () => {
    const usage: TenantUsage = {
      currentObjectCount: 15,
      currentRecordCount: 50000,
      currentStorageBytes: 1073741824,
      deploymentsToday: 3,
      currentUsers: 42,
      apiRequestsThisMinute: 120,
      lastUpdatedAt: '2026-01-15T10:30:00Z',
    };
    const parsed = TenantUsageSchema.parse(usage);
    expect(parsed.currentObjectCount).toBe(15);
    expect(parsed.currentRecordCount).toBe(50000);
    expect(parsed.deploymentsToday).toBe(3);
    expect(parsed.currentUsers).toBe(42);
    expect(parsed.apiRequestsThisMinute).toBe(120);
  });

  it('should apply zero defaults', () => {
    const parsed = TenantUsageSchema.parse({});
    expect(parsed.currentObjectCount).toBe(0);
    expect(parsed.currentRecordCount).toBe(0);
    expect(parsed.currentStorageBytes).toBe(0);
    expect(parsed.deploymentsToday).toBe(0);
    expect(parsed.currentUsers).toBe(0);
    expect(parsed.apiRequestsThisMinute).toBe(0);
  });

  it('should reject negative values', () => {
    expect(() => TenantUsageSchema.parse({ currentObjectCount: -1 })).toThrow();
    expect(() => TenantUsageSchema.parse({ currentUsers: -1 })).toThrow();
    expect(() => TenantUsageSchema.parse({ apiRequestsThisMinute: -1 })).toThrow();
  });
});

describe('QuotaEnforcementResultSchema', () => {
  it('should accept allowed result', () => {
    const result: QuotaEnforcementResult = {
      allowed: true,
    };
    expect(() => QuotaEnforcementResultSchema.parse(result)).not.toThrow();
  });

  it('should accept denied result with details', () => {
    const result: QuotaEnforcementResult = {
      allowed: false,
      exceededQuota: 'maxObjects',
      currentUsage: 50,
      limit: 50,
      message: 'Maximum number of custom objects reached (50/50)',
    };
    const parsed = QuotaEnforcementResultSchema.parse(result);
    expect(parsed.allowed).toBe(false);
    expect(parsed.exceededQuota).toBe('maxObjects');
    expect(parsed.currentUsage).toBe(50);
    expect(parsed.limit).toBe(50);
  });
});

// #14478 (folding in #14519) — both keys carried their unit (seconds) in a
// source JSDoc only; the published `.describe()` named none, so the
// reference-page reader could not tell 300 seconds from 300 milliseconds.
// Renamed with the unit in the key; the old spellings are retiredKey
// tombstones (the nested objects are not strict).
describe('tenant idleTimeout / sessionTimeout → *Seconds (#14478, #14519)', () => {
  it('REFUSES `connectionPool.idleTimeout` with a rename naming `idleTimeoutSeconds`', () => {
    const result = DatabaseLevelIsolationStrategySchema.safeParse({
      strategy: 'isolated_db',
      connectionPool: { idleTimeout: 300 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'connectionPool.idleTimeout');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`connectionPool\.idleTimeout` was removed.*Rename the key to `idleTimeoutSeconds`/s);
  });

  it('REFUSES `accessControl.sessionTimeout` with a rename naming `sessionTimeoutSeconds`', () => {
    const result = TenantSecurityPolicySchema.safeParse({ accessControl: { sessionTimeout: 3600 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'accessControl.sessionTimeout');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`accessControl\.sessionTimeout` was removed.*Rename the key to `sessionTimeoutSeconds`/s);
  });

  it('accepts both suffixed keys at the magnitudes the retired keys carried, with the same defaults', () => {
    const pool = DatabaseLevelIsolationStrategySchema.parse({
      strategy: 'isolated_db',
      connectionPool: { idleTimeoutSeconds: 600 },
    });
    expect(pool.connectionPool?.idleTimeoutSeconds).toBe(600);
    expect(pool.connectionPool).not.toHaveProperty('idleTimeout');
    expect(
      DatabaseLevelIsolationStrategySchema.parse({ strategy: 'isolated_db', connectionPool: {} }).connectionPool?.idleTimeoutSeconds,
    ).toBe(300);

    const policy = TenantSecurityPolicySchema.parse({ accessControl: { sessionTimeoutSeconds: 1800 } });
    expect(policy.accessControl?.sessionTimeoutSeconds).toBe(1800);
    expect(policy.accessControl).not.toHaveProperty('sessionTimeout');
    expect(TenantSecurityPolicySchema.parse({ accessControl: {} }).accessControl?.sessionTimeoutSeconds).toBe(3600);
  });

  it('publishes the unit in the describe — the text the reference pages render (#14519)', () => {
    const pool = DatabaseLevelIsolationStrategySchema.shape.connectionPool.unwrap().shape.idleTimeoutSeconds;
    const access = TenantSecurityPolicySchema.shape.accessControl.unwrap().shape.sessionTimeoutSeconds;
    expect(pool.description).toBe('Idle pool timeout in seconds');
    expect(access.description).toBe('Session timeout in seconds');
  });
});
