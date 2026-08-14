import { describe, it, expect } from 'vitest';
import {
  DatasourceSchema,
  DriverDefinitionSchema,
  DriverType,
  SchemaModeSchema,
  ExternalDatasourceSettingsSchema,
  type Datasource,
} from './datasource.zod';

describe('DriverType', () => {
  it('should accept any string as driver type', () => {
    expect(() => DriverType.parse('postgres')).not.toThrow();
    expect(() => DriverType.parse('custom.driver')).not.toThrow();
    expect(() => DriverType.parse('com.vendor.snowflake')).not.toThrow();
  });
});

describe('datasource.capabilities — RETIRED (#4583)', () => {
  // These used to be five tests asserting the eleven flags parsed and defaulted.
  // They did, faithfully, for a block no runtime ever read — the shape #4001
  // named: a schema that is loose (or here, merely unread) eventually grows a
  // test asserting that state, and the assertion reads like intent.
  //
  // The replacement asserts the removal, and that the author is told where the
  // enforced gate actually is.
  it('rejects a `capabilities` block on a datasource', () => {
    const result = DatasourceSchema.safeParse({
      name: 'analytics',
      driver: 'sqlite',
      config: { filename: ':memory:' },
      capabilities: { readOnly: true },
    });

    expect(result.success).toBe(false);
  });

  it('tells a `readOnly` author that no managed read-only gate exists, rather than renaming the key', () => {
    const result = DatasourceSchema.safeParse({
      name: 'analytics',
      driver: 'sqlite',
      config: { filename: ':memory:' },
      readOnly: true,
    });

    expect(result.success).toBe(false);
    const msg = JSON.stringify(result.error?.issues ?? []);
    // The prescription must name the enforced gate AND its limit. Naming only
    // `external.allowWrites` would repeat the defect this removal closes: the
    // author's datasource is managed, so that key would not gate it either.
    expect(msg).toContain('external.allowWrites');
    expect(msg).toMatch(/managed/);
  });

  it('rejects `capabilities` on a driver definition too', () => {
    const result = DriverDefinitionSchema.safeParse({
      id: 'sqlite',
      label: 'SQLite',
      configSchema: {},
      capabilities: { transactions: true },
    });

    expect(result.success).toBe(false);
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
    });

    expect(driver.description).toBe('PostgreSQL database driver');
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
    // `config.password` is deliberately absent: inline credentials are refused
    // since #7990 (pinned in driver/driver-credential-refusal.test.ts).
    const datasource = DatasourceSchema.parse({
      name: 'production_db',
      label: 'Production Database',
      driver: 'postgres',
      config: {
        host: 'db.example.com',
        port: 5432,
        database: 'production',
        username: 'app_user',
        ssl: true,
      },
      description: 'Main production PostgreSQL database',
      active: true,
    });

    expect(datasource.label).toBe('Production Database');
    expect(datasource.description).toBeDefined();
  });

  it('should accept PostgreSQL datasource', () => {
    // No `config.password` — inline credentials are refused since #7990
    // (pinned in driver/driver-credential-refusal.test.ts).
    const datasource = DatasourceSchema.parse({
      name: 'postgres_db',
      driver: 'postgres',
      config: {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        username: 'user',
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
    // The `${API_KEY}` placeholder stays ACCEPTED here on purpose: `rest_api`
    // ships no config contract, so its `config` is validated against nothing
    // (#4410's honest boundary) — the #8336 placeholder refusal judges only
    // the built-in driver schemas. Pinned as the boundary in
    // driver/driver-placeholder-refusal.test.ts too.
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


  it('refuses datasource with environment variables in config — placeholders are not resolved here (#8336)', () => {
    // INVERTED acceptance pin. This test used to pin (#7990 census) that
    // `${…}` placeholders in NON-credential connection keys parse — recording
    // the measured fact that nothing resolves them and the strings reach the
    // client verbatim, the masked-failure shape. The #8336 ruling (direction
    // 2, 2026-08-13) refuses the syntax at publish instead: same input,
    // opposite verdict. The per-key family pins live in
    // driver/driver-placeholder-refusal.test.ts.
    const inverted = DatasourceSchema.safeParse({
      name: 'secure_db',
      driver: 'postgres',
      config: {
        host: '${DB_HOST}',
        port: 5432,
        database: '${DB_NAME}',
        username: '${DB_USER}',
      },
    });
    expect(inverted.success).toBe(false);
    const paths = inverted.error!.issues
      .filter((i) => i.message.includes('placeholders are not resolved here'))
      .map((i) => i.path.join('.'));
    expect(paths.sort()).toEqual(['config.database', 'config.host', 'config.username']);

    // Unchanged half: `config.password` is refused whatever its value,
    // placeholder included — the KEY is the cleartext sink (#7990).
    const refused = DatasourceSchema.safeParse({
      name: 'secure_db',
      driver: 'postgres',
      config: { database: 'prod', password: '${DB_PASSWORD}' },
    });
    expect(refused.success).toBe(false);
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
      // An empty `external: {}` is enough — every key below is a default. It
      // used to say `{ label: … }`, which #4583 removed: the federation block
      // never had a display name of its own (the top-level `label` is what
      // Setup renders), so the key was only ever making this literal look less
      // bare.
      external: {},
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

  // ── #8153 — the managed `credentialsRef` allowance ─────────────────────────
  //
  // The Studio wizard's `createDatasource` stores the secret in the secrets
  // store and writes `external: { credentialsRef }` onto the row — without
  // consulting `schemaMode`, which defaults to 'managed'. Until #8153 the
  // refinement refused ANY `external` on managed, so every wizard-created
  // datasource with a password was badged `_diagnostics.valid:false` and
  // `PUT /meta` answered 422 on the service's own output. Maintainer ruling
  // (issue #8153 comment, 2026-08-13): allow `external.credentialsRef` — and
  // only it — on managed; keep refusing every federation key.

  it('accepts the exact shape createDatasource writes on a managed row (#8153 happy path)', () => {
    // The measured persisted shape from #8153 — no `schemaMode`, so it
    // defaults to 'managed'; `external` carries only the secrets-store ref.
    const wizardRow = {
      name: 'good_pg',
      driver: 'postgres',
      config: { host: 'db.internal', database: 'mydb', username: 'app' },
      origin: 'runtime',
      external: { credentialsRef: 'sys_secret:bound' },
    } as const;
    const result = DatasourceSchema.safeParse(wizardRow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaMode).toBe('managed');
      expect(result.data.external?.credentialsRef).toBe('sys_secret:bound');
    }
  });

  it('round-trips the wizard row: the parsed output (defaults applied) re-parses valid (#8153)', () => {
    // `PUT /meta` re-parses what `GET` served — the parsed shape, with every
    // `external` default key materialized. The allowance judges VALUES, not
    // key presence, precisely so this round-trip stays valid.
    const first = DatasourceSchema.parse({
      name: 'good_pg',
      driver: 'postgres',
      config: { host: 'db.internal', database: 'mydb', username: 'app' },
      origin: 'runtime',
      external: { credentialsRef: 'sys_secret:bound' },
    });
    // Defaults really were applied — the second parse sees the full block.
    expect(first.external?.allowWrites).toBe(false);
    expect(first.external?.queryTimeoutMs).toBe(30_000);
    const second = DatasourceSchema.safeParse(first);
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.external?.credentialsRef).toBe('sys_secret:bound');
    }
  });

  it('still refuses `external.allowWrites` on a managed row, with the existing guidance (#8153)', () => {
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      schemaMode: 'managed',
      external: { allowWrites: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('external'));
      expect(issue?.message).toContain(`'external' settings only apply when schemaMode != 'managed'.`);
      expect(issue?.message).toContain('allowWrites');
    }
  });

  it('still refuses `external.allowedSchemas` on a managed row (#8153)', () => {
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      external: { allowedSchemas: ['public'] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('external'));
      expect(issue?.message).toContain(`'external' settings only apply when schemaMode != 'managed'.`);
      expect(issue?.message).toContain('allowedSchemas');
    }
  });

  it('still refuses non-default `validation` and `queryTimeoutMs` on a managed row (#8153)', () => {
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      external: { validation: { onMismatch: 'warn' }, queryTimeoutMs: 5_000 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('external'));
      expect(issue?.message).toContain('queryTimeoutMs');
      expect(issue?.message).toContain('validation');
    }
  });

  it('refuses credentialsRef + a federation key together — the allowance does not smuggle (#8153)', () => {
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      external: { credentialsRef: 'sys_secret:bound', allowWrites: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('external'));
      // The refusal names the federation key, never the allowed ref.
      expect(issue?.message).toContain('allowWrites');
      expect(issue?.message).not.toContain('remove: credentialsRef');
    }
  });

  it('accepts explicitly-written DEFAULT federation values on a managed row — inert content (#8153)', () => {
    // Deliberate: the check judges effective federation content. An explicit
    // `allowWrites: false` is byte-equal to the applied default and gates
    // nothing — refusing it would 422 re-parses of served output, which
    // materializes every default key.
    const result = DatasourceSchema.safeParse({
      name: 'default',
      driver: 'postgres',
      config: { database: 'mydb' },
      external: {
        credentialsRef: 'sys_secret:bound',
        allowWrites: false,
        queryTimeoutMs: 30_000,
        validation: { onMismatch: 'fail', checkOnBoot: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it('keeps full external acceptance on schemaMode="external" — unchanged by #8153', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { url: 'postgres://user@warehouse.internal/analytics' },
      schemaMode: 'external',
      external: {
        allowedSchemas: ['public', 'mart'],
        allowWrites: true,
        validation: { onMismatch: 'warn', checkOnBoot: false, checkIntervalMs: 60_000 },
        credentialsRef: 'secret:warehouse/readonly',
        queryTimeoutMs: 15_000,
      },
    });
    expect(result.success).toBe(true);
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
      allowedSchemas: ['public', 'mart'],
      allowWrites: true,
      validation: { onMismatch: 'warn', checkOnBoot: false, checkIntervalMs: 60_000 },
      credentialsRef: 'secret:warehouse/readonly',
      queryTimeoutMs: 15_000,
    });
    expect(settings.allowedSchemas).toEqual(['public', 'mart']);
    expect(settings.validation.onMismatch).toBe('warn');
    expect(settings.validation.checkIntervalMs).toBe(60_000);
  });

  // ── #4583 batches B/C/D — the remaining inert datasource surface ──────────
  //
  // Same finding as `capabilities`: declared, strict-guarded, read by nothing.
  // Each rejection has to name the mechanism that DOES decide the behaviour,
  // which is why these assert the message and not merely the failure.

  it('rejects the `retryPolicy` block, and does NOT send the author to hook/job retryPolicy', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'sqlite',
      config: { filename: ':memory:' },
      retryPolicy: { maxRetries: 5, baseDelayMs: 1000 },
    });

    expect(result.success).toBe(false);
    const msg = JSON.stringify(result.error?.issues ?? []);
    // The trap this pins: `hook.retryPolicy` / `job.retryPolicy` ARE enforced
    // and spell the delay `backoffMs`. An author who reads "retryPolicy is
    // dead" and renames the key onto a datasource anyway, or moves these
    // values to a hook expecting the datasource to retry, has not been helped.
    expect(msg).toMatch(/backoffMs/);
    expect(msg).toMatch(/hook|job/);
  });

  it('rejects the `healthCheck` block and points at the on-demand probe', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'sqlite',
      config: { filename: ':memory:' },
      healthCheck: { enabled: true, intervalMs: 30_000 },
    });

    expect(result.success).toBe(false);
    const msg = JSON.stringify(result.error?.issues ?? []);
    expect(msg).toMatch(/ping|checkHealth/);
    // Must not be confused with the one recurring datasource timer, which
    // checks schema drift rather than liveness.
    expect(msg).toMatch(/checkIntervalMs/);
  });

  it('rejects `external.label` in favour of the top-level label', () => {
    const result = ExternalDatasourceSettingsSchema.safeParse({
      label: 'Snowflake — ANALYTICS / PROD',
      allowWrites: false,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues ?? [])).toMatch(/top-level/i);
  });

  it('rejects `external.requirePermission` — it gated nothing', () => {
    const result = ExternalDatasourceSettingsSchema.safeParse({
      requirePermission: 'analytics_admin',
      allowWrites: false,
    });

    expect(result.success).toBe(false);
    // The prescription must point at what really governs access.
    expect(JSON.stringify(result.error?.issues ?? [])).toMatch(/permission set|RLS/i);
  });
});
