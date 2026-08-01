import { describe, it, expect } from 'vitest';
import {
  DatasourceSchema,
  DatasourceCapabilities,
  DriverDefinitionSchema,
  DriverType,
  SchemaModeSchema,
  ExternalDatasourceSettingsSchema,
  type Datasource,
  type DatasourceCapabilitiesType,
} from './datasource.zod';

describe('DriverType', () => {
  it('should accept any string as driver type', () => {
    expect(() => DriverType.parse('postgres')).not.toThrow();
    expect(() => DriverType.parse('custom.driver')).not.toThrow();
    expect(() => DriverType.parse('com.vendor.snowflake')).not.toThrow();
  });
});

describe('DatasourceCapabilities', () => {
  it('should accept empty capabilities with defaults', () => {
    const capabilities = DatasourceCapabilities.parse({});

    expect(capabilities.transactions).toBe(false);
    expect(capabilities.queryFilters).toBe(false);
    expect(capabilities.queryAggregations).toBe(false);
    expect(capabilities.querySorting).toBe(false);
    expect(capabilities.queryPagination).toBe(false);
    expect(capabilities.queryWindowFunctions).toBe(false);
    expect(capabilities.querySubqueries).toBe(false);
    expect(capabilities.joins).toBe(false);
    expect(capabilities.fullTextSearch).toBe(false);
    expect(capabilities.readOnly).toBe(false);
    expect(capabilities.dynamicSchema).toBe(false);
  });

  it('should accept full capabilities for SQL database', () => {
    const capabilities = DatasourceCapabilities.parse({
      transactions: true,
      queryFilters: true,
      queryAggregations: true,
      querySorting: true,
      queryPagination: true,
      queryWindowFunctions: true,
      querySubqueries: true,
      joins: true,
      fullTextSearch: true,
      readOnly: false,
      dynamicSchema: false,
    });

    expect(capabilities.transactions).toBe(true);
    expect(capabilities.queryWindowFunctions).toBe(true);
  });

  it('should accept limited capabilities for NoSQL database', () => {
    const capabilities = DatasourceCapabilities.parse({
      transactions: false,
      queryFilters: true,
      queryAggregations: true,
      querySorting: true,
      queryPagination: true,
      joins: false,
      dynamicSchema: true,
    });

    expect(capabilities.joins).toBe(false);
    expect(capabilities.dynamicSchema).toBe(true);
  });

  it('should accept read-only capabilities', () => {
    const capabilities = DatasourceCapabilities.parse({
      readOnly: true,
      queryFilters: true,
      querySorting: true,
    });

    expect(capabilities.readOnly).toBe(true);
  });

  it('should accept capabilities for Excel/CSV', () => {
    const capabilities = DatasourceCapabilities.parse({
      transactions: false,
      queryFilters: true,
      querySorting: true,
      joins: false,
      readOnly: false,
    });

    expect(capabilities.transactions).toBe(false);
  });
});

describe('DriverDefinitionSchema', () => {
  it('should accept valid driver definition', () => {
    const driver = DriverDefinitionSchema.parse({
      id: 'postgres',
      label: 'PostgreSQL',
      configSchema: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          port: { type: 'number' },
          database: { type: 'string' },
        },
      },
    });

    expect(driver.id).toBe('postgres');
    expect(driver.label).toBe('PostgreSQL');
  });

  it('should accept driver with all fields', () => {
    const driver = DriverDefinitionSchema.parse({
      id: 'postgres',
      label: 'PostgreSQL',
      description: 'PostgreSQL database driver',
      icon: 'database',
      configSchema: {
        type: 'object',
        required: ['host', 'database'],
        properties: {
          host: { type: 'string' },
          port: { type: 'number', default: 5432 },
          database: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
      capabilities: {
        transactions: true,
        queryFilters: true,
        queryAggregations: true,
      },
    });

    expect(driver.description).toBe('PostgreSQL database driver');
    expect(driver.capabilities).toBeDefined();
  });

  it('should accept MongoDB driver definition', () => {
    const driver = DriverDefinitionSchema.parse({
      id: 'mongo',
      label: 'MongoDB',
      configSchema: {
        type: 'object',
        properties: {
          connectionString: { type: 'string' },
        },
      },
    });

    expect(driver.id).toBe('mongo');
  });

  it('should accept REST API driver definition', () => {
    const driver = DriverDefinitionSchema.parse({
      id: 'rest_api',
      label: 'REST API',
      configSchema: {
        type: 'object',
        properties: {
          baseUrl: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
    });

    expect(driver.id).toBe('rest_api');
  });
});

describe('DatasourceSchema', () => {
  it('should accept valid minimal datasource', () => {
    const datasource: Datasource = {
      name: 'main_db',
      driver: 'postgres',
      config: {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
      },
    };

    expect(() => DatasourceSchema.parse(datasource)).not.toThrow();
  });

  it('should validate datasource name format (snake_case)', () => {
    expect(() => DatasourceSchema.parse({
      name: 'valid_datasource_name',
      driver: 'postgres',
      config: { database: 'mydb' },
    })).not.toThrow();

    expect(() => DatasourceSchema.parse({
      name: 'InvalidDatasource',
      driver: 'postgres',
      config: { database: 'mydb' },
    })).toThrow();

    expect(() => DatasourceSchema.parse({
      name: 'invalid-datasource',
      driver: 'postgres',
      config: { database: 'mydb' },
    })).toThrow();
  });

  it('should apply default active value', () => {
    const datasource = DatasourceSchema.parse({
      name: 'test_db',
      driver: 'postgres',
      config: { database: 'mydb' },
    });

    expect(datasource.active).toBe(true);
  });

  it('should accept datasource with all fields', () => {
    const datasource = DatasourceSchema.parse({
      name: 'production_db',
      label: 'Production Database',
      driver: 'postgres',
      config: {
        host: 'db.example.com',
        port: 5432,
        database: 'production',
        username: 'app_user',
        password: '${DB_PASSWORD}',
        ssl: true,
      },
      capabilities: {
        transactions: true,
        queryFilters: true,
        queryAggregations: true,
      },
      description: 'Main production PostgreSQL database',
      active: true,
    });

    expect(datasource.label).toBe('Production Database');
    expect(datasource.description).toBeDefined();
    expect(datasource.capabilities).toBeDefined();
  });

  it('should accept PostgreSQL datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'postgres_db',
      driver: 'postgres',
      config: {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        username: 'user',
        password: 'pass',
      },
    });

    expect(datasource.driver).toBe('postgres');
  });

  it('should accept MySQL datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'mysql_db',
      driver: 'mysql',
      config: {
        host: 'localhost',
        port: 3306,
        database: 'mydb',
      },
    });

    expect(datasource.driver).toBe('mysql');
  });

  it('should accept MongoDB datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'mongo_db',
      driver: 'mongo',
      config: {
        url: 'mongodb://localhost:27017/mydb',
      },
    });

    expect(datasource.driver).toBe('mongo');
  });

  // This fixture used to spell the URI `connectionString`, a key the mongo
  // builder never read — so the datasource it described would have connected to
  // mongodb://localhost:27017 with no database, and the test asserting it was
  // "accepted" was asserting the silence #4410 removed.
  it('rejects a mongo config that spells the URI `connectionString`', () => {
    const result = DatasourceSchema.safeParse({
      name: 'mongo_db',
      driver: 'mongo',
      config: { connectionString: 'mongodb://localhost:27017/mydb' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['config']);
    expect(result.error!.issues[0]!.message).toContain('`connectionString` → `url`');
  });

  it('should accept Redis datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'redis_cache',
      driver: 'redis',
      config: {
        host: 'localhost',
        port: 6379,
      },
    });

    expect(datasource.driver).toBe('redis');
  });

  it('should accept Salesforce datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'salesforce',
      driver: 'salesforce',
      config: {
        instanceUrl: 'https://example.my.salesforce.com',
        clientId: 'client_id',
        clientSecret: '${SF_CLIENT_SECRET}',
      },
    });

    expect(datasource.driver).toBe('salesforce');
  });

  it('should accept Excel datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'excel_import',
      driver: 'excel',
      config: {
        filePath: '/data/import.xlsx',
      },
    });

    expect(datasource.driver).toBe('excel');
  });

  it('should accept REST API datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'external_api',
      driver: 'rest_api',
      config: {
        baseUrl: 'https://api.example.com',
        apiKey: '${API_KEY}',
      },
    });

    expect(datasource.driver).toBe('rest_api');
  });

  it('should accept inactive datasource', () => {
    const datasource = DatasourceSchema.parse({
      name: 'disabled_db',
      driver: 'postgres',
      config: { database: 'mydb' },
      active: false,
    });

    expect(datasource.active).toBe(false);
  });

  it('should accept datasource with capability overrides', () => {
    const datasource = DatasourceSchema.parse({
      name: 'custom_db',
      driver: 'postgres',
      config: { database: 'mydb' },
      capabilities: {
        queryWindowFunctions: false,
        querySubqueries: false,
      },
    });

    expect(datasource.capabilities?.queryWindowFunctions).toBe(false);
  });

  it('should accept datasource with environment variables in config', () => {
    const datasource = DatasourceSchema.parse({
      name: 'secure_db',
      driver: 'postgres',
      config: {
        host: '${DB_HOST}',
        port: 5432,
        database: '${DB_NAME}',
        username: '${DB_USER}',
        password: '${DB_PASSWORD}',
      },
    });

    expect(datasource.config.password).toBe('${DB_PASSWORD}');
  });

  it('should accept datasource with complex config', () => {
    const datasource = DatasourceSchema.parse({
      name: 'complex_db',
      driver: 'postgres',
      config: {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        ssl: true,
      },
      pool: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
      },
      ssl: {
        enabled: true,
        rejectUnauthorized: false,
        ca: 'certificate_content',
      },
    });

    expect(datasource.pool).toBeDefined();
    expect(datasource.config.ssl).toBe(true);
    // Certificates belong to the datasource-level block, which the factory now
    // carries down to the client (#4410). Inside `config`, `ssl` is on/off.
    expect(datasource.ssl?.ca).toBe('certificate_content');
  });

  // The fixture above used to nest `pool` INSIDE `config`, where no driver
  // reads it — so it asserted a pooled datasource that was running on the
  // factory's hardcoded defaults. The rejection now carries the relocation.
  it('rejects pool sizing nested inside `config`', () => {
    const result = DatasourceSchema.safeParse({
      name: 'complex_db',
      driver: 'postgres',
      config: { database: 'mydb', pool: { min: 2, max: 10 } },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`pool: { max: … }`');
  });

  it('should reject datasource without required fields', () => {
    expect(() => DatasourceSchema.parse({
      driver: 'postgres',
      config: { database: 'mydb' },
    })).toThrow();

    expect(() => DatasourceSchema.parse({
      name: 'test_db',
      config: {},
    })).toThrow();

    expect(() => DatasourceSchema.parse({
      name: 'test_db',
      driver: 'postgres',
    })).toThrow();
  });
});

// ============================================================================
// Protocol Improvement Tests: Datasource SSL
// ============================================================================

describe('DatasourceSchema - ssl', () => {
  it('should accept datasource with SSL config', () => {
    const result = DatasourceSchema.parse({
      name: 'secure_db',
      driver: 'postgres',
      config: { host: 'db.example.com', port: 5432, database: 'mydb' },
      ssl: {
        enabled: true,
        rejectUnauthorized: true,
        ca: '/path/to/ca.pem',
      },
    });
    expect(result.ssl?.enabled).toBe(true);
    expect(result.ssl?.rejectUnauthorized).toBe(true);
    expect(result.ssl?.ca).toBe('/path/to/ca.pem');
  });

  it('should accept SSL with client certificates', () => {
    const result = DatasourceSchema.parse({
      name: 'mtls_db',
      driver: 'postgres',
      config: { host: 'db.secure.com', database: 'mydb' },
      ssl: {
        enabled: true,
        ca: '/certs/ca.pem',
        cert: '/certs/client.pem',
        key: '/certs/client-key.pem',
      },
    });
    expect(result.ssl?.cert).toBe('/certs/client.pem');
    expect(result.ssl?.key).toBe('/certs/client-key.pem');
  });

  it('should default rejectUnauthorized to true', () => {
    const result = DatasourceSchema.parse({
      name: 'ssl_db',
      driver: 'mysql',
      config: { database: 'mydb' },
      ssl: { enabled: true },
    });
    expect(result.ssl?.rejectUnauthorized).toBe(true);
  });

  it('should accept datasource without SSL (optional)', () => {
    const result = DatasourceSchema.parse({
      name: 'local_db',
      driver: 'sqlite',
      config: { filename: './data.db' },
    });
    expect(result.ssl).toBeUndefined();
  });
});

describe('SchemaMode & External Federation (ADR-0015)', () => {
  it('should default schemaMode to "managed" with no external block', () => {
    const ds = DatasourceSchema.parse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
    });
    expect(ds.schemaMode).toBe('managed');
    expect(ds.external).toBeUndefined();
  });

  it('should accept the three valid schema modes', () => {
    expect(() => SchemaModeSchema.parse('managed')).not.toThrow();
    expect(() => SchemaModeSchema.parse('external')).not.toThrow();
    expect(() => SchemaModeSchema.parse('validate-only')).not.toThrow();
  });

  it('should reject an unknown schema mode', () => {
    expect(() => SchemaModeSchema.parse('replica')).toThrow();
  });

  it('should accept schemaMode="external" with an external block and apply defaults', () => {
    const ds = DatasourceSchema.parse({
      name: 'warehouse',
      driver: 'postgres',
      config: { url: 'postgres://user@warehouse.internal/analytics' },
      schemaMode: 'external',
      external: { label: 'Analytics Warehouse' },
    });
    expect(ds.schemaMode).toBe('external');
    // ExternalDatasourceSettingsSchema defaults
    expect(ds.external?.allowWrites).toBe(false);
    expect(ds.external?.queryTimeoutMs).toBe(30_000);
    expect(ds.external?.validation.onMismatch).toBe('fail');
    expect(ds.external?.validation.checkOnBoot).toBe(true);
  });

  it('should require external settings when schemaMode != "managed"', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { database: 'mydb' },
      schemaMode: 'external',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('external'))).toBe(true);
    }
  });

  it('should forbid external settings when schemaMode === "managed"', () => {
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      schemaMode: 'managed',
      external: { allowWrites: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('external'))).toBe(true);
    }
  });

  it('should require external settings for validate-only mode too', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { database: 'mydb' },
      schemaMode: 'validate-only',
    });
    expect(result.success).toBe(false);
  });

  it('should parse a fully-specified external settings block', () => {
    const settings = ExternalDatasourceSettingsSchema.parse({
      label: 'Snowflake — ANALYTICS / PROD',
      allowedSchemas: ['public', 'mart'],
      allowWrites: true,
      validation: { onMismatch: 'warn', checkOnBoot: false, checkIntervalMs: 60_000 },
      credentialsRef: 'secret:warehouse/readonly',
      queryTimeoutMs: 15_000,
      requirePermission: 'analytics_admin',
    });
    expect(settings.allowedSchemas).toEqual(['public', 'mart']);
    expect(settings.validation.onMismatch).toBe('warn');
    expect(settings.validation.checkIntervalMs).toBe(60_000);
  });
});
