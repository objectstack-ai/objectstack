import { describe, it, expect } from 'vitest';
import { TursoConfigSchema, TursoSyncConfigSchema, TursoDriverSpec } from './turso.zod';
import { TursoDriver } from '../turso-driver';

describe('TursoConfigSchema', () => {
  it('should accept minimal remote config', () => {
    const config = TursoConfigSchema.parse({
      url: 'libsql://my-db-orgname.turso.io',
      authToken: 'eyJhbGciOi...',
    });

    expect(config.url).toBe('libsql://my-db-orgname.turso.io');
    expect(config.authToken).toBe('eyJhbGciOi...');
    expect(config.concurrency).toBe(20);
  });

  it('should accept local file config', () => {
    const config = TursoConfigSchema.parse({
      url: 'file:./local.db',
    });

    expect(config.url).toBe('file:./local.db');
    expect(config.authToken).toBeUndefined();
  });

  it('should accept in-memory config', () => {
    const config = TursoConfigSchema.parse({
      url: ':memory:',
    });

    expect(config.url).toBe(':memory:');
  });

  it('should accept embedded replica config', () => {
    const config = TursoConfigSchema.parse({
      url: 'file:./local-replica.db',
      syncUrl: 'libsql://my-db-orgname.turso.io',
      authToken: 'eyJhbGciOi...',
      localPath: './local-replica.db',
      sync: {
        intervalSeconds: 30,
        onConnect: true,
      },
    });

    expect(config.syncUrl).toBe('libsql://my-db-orgname.turso.io');
    expect(config.localPath).toBe('./local-replica.db');
    expect(config.sync).toBeDefined();
    expect(config.sync!.intervalSeconds).toBe(30);
    expect(config.sync!.onConnect).toBe(true);
  });

  it('should accept config with all fields', () => {
    const config = TursoConfigSchema.parse({
      url: 'libsql://my-db-orgname.turso.io',
      authToken: 'eyJhbGciOi...',
      encryptionKey: 'my-secret-key-256',
      concurrency: 50,
      syncUrl: 'libsql://my-db-orgname.turso.io',
      localPath: '/data/replica.db',
      sync: {
        intervalSeconds: 120,
        onConnect: false,
      },
      timeout: 30000,
      wasm: true,
    });

    expect(config.encryptionKey).toBe('my-secret-key-256');
    expect(config.concurrency).toBe(50);
    expect(config.timeout).toBe(30000);
    expect(config.wasm).toBe(true);
  });

  it('should apply correct defaults', () => {
    const config = TursoConfigSchema.parse({
      url: 'libsql://my-db.turso.io',
    });

    expect(config.concurrency).toBe(20);
    expect(config.authToken).toBeUndefined();
    expect(config.encryptionKey).toBeUndefined();
    expect(config.syncUrl).toBeUndefined();
    expect(config.localPath).toBeUndefined();
    expect(config.sync).toBeUndefined();
    expect(config.timeout).toBeUndefined();
    expect(config.wasm).toBeUndefined();
  });

  it('should accept https URL', () => {
    const config = TursoConfigSchema.parse({
      url: 'https://my-db-orgname.turso.io',
      authToken: 'token',
    });

    expect(config.url).toBe('https://my-db-orgname.turso.io');
  });

  it('should accept ws/wss URL', () => {
    const config = TursoConfigSchema.parse({
      url: 'wss://my-db-orgname.turso.io',
      authToken: 'token',
    });

    expect(config.url).toBe('wss://my-db-orgname.turso.io');
  });

  it('should reject config without url', () => {
    expect(() => TursoConfigSchema.parse({})).toThrow();
    expect(() => TursoConfigSchema.parse({ authToken: 'token' })).toThrow();
  });

  it('should reject config with invalid concurrency', () => {
    expect(() => TursoConfigSchema.parse({
      url: ':memory:',
      concurrency: 0,
    })).toThrow();
  });

  it('should reject config with invalid concurrency type', () => {
    expect(() => TursoConfigSchema.parse({
      url: ':memory:',
      concurrency: 'ten',
    })).toThrow();
  });

  it('should reject config with negative timeout', () => {
    expect(() => TursoConfigSchema.parse({
      url: ':memory:',
      timeout: -1,
    })).toThrow();
  });

  it('should accept config with environment variable patterns', () => {
    const config = TursoConfigSchema.parse({
      url: '${TURSO_DATABASE_URL}',
      authToken: '${TURSO_AUTH_TOKEN}',
    });

    expect(config.url).toBe('${TURSO_DATABASE_URL}');
    expect(config.authToken).toBe('${TURSO_AUTH_TOKEN}');
  });

  it('should accept config with custom concurrency', () => {
    const config = TursoConfigSchema.parse({
      url: ':memory:',
      concurrency: 100,
    });

    expect(config.concurrency).toBe(100);
  });

  it('should accept zero timeout (no timeout)', () => {
    const config = TursoConfigSchema.parse({
      url: ':memory:',
      timeout: 0,
    });

    expect(config.timeout).toBe(0);
  });
});

describe('TursoSyncConfigSchema', () => {
  it('should accept valid sync config', () => {
    const config = TursoSyncConfigSchema.parse({
      intervalSeconds: 30,
      onConnect: true,
    });

    expect(config.intervalSeconds).toBe(30);
    expect(config.onConnect).toBe(true);
  });

  it('should apply defaults', () => {
    const config = TursoSyncConfigSchema.parse({});

    expect(config.intervalSeconds).toBe(60);
    expect(config.onConnect).toBe(true);
  });

  it('should accept zero intervalSeconds (manual sync)', () => {
    const config = TursoSyncConfigSchema.parse({
      intervalSeconds: 0,
    });

    expect(config.intervalSeconds).toBe(0);
  });

  it('should reject negative intervalSeconds', () => {
    expect(() => TursoSyncConfigSchema.parse({
      intervalSeconds: -1,
    })).toThrow();
  });

  it('should accept onConnect false', () => {
    const config = TursoSyncConfigSchema.parse({
      onConnect: false,
    });

    expect(config.onConnect).toBe(false);
  });
});

describe('TursoDriverSpec', () => {
  it('should have correct id', () => {
    expect(TursoDriverSpec.id).toBe('turso');
  });

  it('should have correct label', () => {
    expect(TursoDriverSpec.label).toBe('Turso (libSQL)');
  });

  it('should have a description', () => {
    expect(TursoDriverSpec.description).toBeDefined();
    expect(typeof TursoDriverSpec.description).toBe('string');
    expect(TursoDriverSpec.description).toContain('SQLite');
    expect(TursoDriverSpec.description).toContain('edge');
  });

  it('should have an icon', () => {
    expect(TursoDriverSpec.icon).toBe('database');
  });

  // `datasource.capabilities` was removed in @objectstack/spec 17.0.0 (#4583,
  // ADR-0049) and the definition schema is strict since #4001, so declaring the
  // block again throws at import — which is how it was caught. The six
  // assertions that used to read the flags are replaced by one that pins the
  // absence, so a re-added block fails here rather than only in CI.
  it('declares no capabilities block — the key is retired, not optional', () => {
    expect('capabilities' in TursoDriverSpec).toBe(false);
  });

  // The retired block's assertions checked that a DECLARATION existed, never
  // that any behaviour followed from it — precisely the "declared but
  // unenforced" shape ADR-0049 removes. Pinning the absence (above) stops it
  // coming back; these two re-ask the original questions where the answer
  // actually changes what the engine does — the runtime driver's `supports`.
  it('advertises its real capability surface on the DRIVER, not the catalog entry', () => {
    const driver = new TursoDriver({ url: 'file:./capability-probe.db' });

    // The bit this driver claims for itself, and the only one whose value the
    // engine acts on here: batched DDL, ANDed with `syncSchemasBatch`'s
    // presence before the engine will use the batch path.
    expect(driver.supports.batchSchemaSync).toBe(true);
    expect(typeof driver.syncSchemasBatch).toBe('function');

    // What this test used to assert — fullTextSearch / jsonQuery / queryCTE /
    // savepoints / connectionPooling — was accurate about libSQL and consulted
    // by nobody, so objectstack#4634 retired those bits from
    // `DriverCapabilities` together with 26 more (ADR-0049). Same lesson as the
    // catalog `capabilities` block above, one layer down: a flag no dispatcher
    // reads is not a capability, it is a comment with a type.
  });

  it('drops native date bucketing in REMOTE mode, where the transport cannot do it', () => {
    // Not a cosmetic flag: the analytics engine trusts
    // `supports.queryDateGranularity` and pushes a structured groupBy down to a
    // remote transport that cannot bucket, which is how a dashboard widget
    // hangs on a 500. Local keeps native bucketing; remote falls back to
    // in-memory, which the contract guarantees is always correct.
    const local = new TursoDriver({ url: 'file:./local.db' }).supports;
    const remote = new TursoDriver({
      url: 'libsql://db-org.turso.io',
      authToken: 'token',
    }).supports;

    expect(Object.keys(remote.queryDateGranularity ?? {})).toHaveLength(0);
    expect(Object.keys(local.queryDateGranularity ?? {}).length).toBeGreaterThan(0);
  });
});
