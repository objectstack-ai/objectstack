import { describe, it, expect } from 'vitest';
import { PostgresConfigSchema } from './postgres.zod';

describe('PostgresConfigSchema', () => {
  it('should accept valid minimal config', () => {
    const config = PostgresConfigSchema.parse({
      database: 'mydb',
    });

    expect(config.database).toBe('mydb');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(5432);
    expect(config.schema).toBe('public');
  });

  it('should accept config with connection URI', () => {
    // Credential-free URL since #8082: a `user:password@` userinfo is refused
    // at publish (see driver-credential-refusal.test.ts for the family pins).
    const config = PostgresConfigSchema.parse({
      url: 'postgresql://user@db.example.com:5432/production',
      database: 'production',
    });

    expect(config.url).toBe('postgresql://user@db.example.com:5432/production');
  });

  it('should accept config with all fields', () => {
    // `password` is deliberately absent: inline credentials are refused since
    // #7990 — the refusal itself is pinned in driver-credential-refusal.test.ts.
    const config = PostgresConfigSchema.parse({
      url: 'postgresql://localhost/mydb',
      database: 'production',
      host: 'db.example.com',
      port: 5433,
      username: 'app_user',
      schema: 'app_schema',
      ssl: true,
      applicationName: 'objectstack',
      statementTimeout: 30000,
    });

    expect(config.host).toBe('db.example.com');
    expect(config.port).toBe(5433);
    expect(config.schema).toBe('app_schema');
    expect(config.ssl).toBe(true);
    expect(config.applicationName).toBe('objectstack');
    expect(config.statementTimeout).toBe(30000);
  });

  it('should apply correct defaults', () => {
    const config = PostgresConfigSchema.parse({
      database: 'testdb',
    });

    expect(config.host).toBe('localhost');
    expect(config.port).toBe(5432);
    expect(config.schema).toBe('public');
    expect(config.url).toBeUndefined();
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.ssl).toBeUndefined();
    expect(config.applicationName).toBeUndefined();
    expect(config.statementTimeout).toBeUndefined();
  });

  it('should accept ssl as boolean', () => {
    const config = PostgresConfigSchema.parse({
      database: 'mydb',
      ssl: false,
    });

    expect(config.ssl).toBe(false);
  });

  // `config.ssl` is the on/off shorthand; certificates live in the
  // datasource-level `ssl` block, which #4410 wired through to the client (it
  // was declared, strict and read by nobody before that). The narrowing is
  // forced by the connection form: it renders anything that is not
  // boolean/enum/number as a text input, so a `boolean | object` union here
  // would produce a wizard whose every `ssl` value the gate rejects.
  it('rejects the certificate-bearing object form, naming where it belongs', () => {
    const result = PostgresConfigSchema.safeParse({
      database: 'mydb',
      ssl: {
        rejectUnauthorized: false,
        ca: '-----BEGIN CERTIFICATE-----\nMIIB...',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.') === 'ssl')).toBe(true);
  });

  it('points a misplaced certificate key at the datasource-level block', () => {
    const result = PostgresConfigSchema.safeParse({
      database: 'mydb',
      ca: '-----BEGIN CERTIFICATE-----\nMIIB...',
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('datasource-level `ssl` block');
  });

  it('should reject a config with no connection target at all', () => {
    // Neither `database` nor `url`: the pg client would then open its own
    // default (localhost, the OS user's database), so an empty config is a
    // datasource pointing somewhere nobody chose.
    expect(() => PostgresConfigSchema.parse({})).toThrow();
    expect(() => PostgresConfigSchema.parse({ host: 'localhost' })).toThrow();
  });

  it('accepts a `url` on its own as the connection target', () => {
    const config = PostgresConfigSchema.parse({
      url: 'postgresql://user@db.example.com:5432/analytics',
    });

    expect(config.database).toBeUndefined();
  });

  it('should reject config with invalid port type', () => {
    expect(() => PostgresConfigSchema.parse({
      database: 'mydb',
      port: 'invalid',
    })).toThrow();
  });

  it('should reject config with invalid ssl value', () => {
    expect(() => PostgresConfigSchema.parse({
      database: 'mydb',
      ssl: 'yes',
    })).toThrow();
  });

  it('rejects pool sizing, and says where it belongs', () => {
    // `max` / `min` / `idleTimeoutMillis` / `connectionTimeoutMillis` were
    // declared here and read by nothing: the factory hardcoded its own pool. The
    // datasource-level `pool` block is the one the factory now honours, so the
    // rejection relocates rather than merely refusing (#4410).
    const result = PostgresConfigSchema.safeParse({
      database: 'mydb',
      max: 100,
      min: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`pool: { max: … }`');
    expect(result.error!.issues[0]!.message).toContain('`pool: { min: … }`');
  });

  it('rejects an unknown key with a rename suggestion', () => {
    const result = PostgresConfigSchema.safeParse({
      database: 'mydb',
      hostname: 'db.internal',
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`hostname` → `host`');
  });

  it('rejects `user`, pointing at the canonical `username`', () => {
    const result = PostgresConfigSchema.safeParse({ database: 'mydb', user: 'app' });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`user` → `username`');
  });

  it('should accept config with environment variable patterns', () => {
    // NOTE (#7990 census): nothing in the runtime resolves `${…}` placeholders
    // in datasource config — these strings reach the client verbatim. The test
    // pins only that placeholder-shaped strings parse for NON-credential keys;
    // `password` is refused whatever its value (including a placeholder),
    // because the key itself is the cleartext sink.
    const config = PostgresConfigSchema.parse({
      database: '${DB_NAME}',
      host: '${DB_HOST}',
      username: '${DB_USER}',
    });

    expect(config.database).toBe('${DB_NAME}');
    expect(config.host).toBe('${DB_HOST}');
  });

  it('accepts the dev-only autoMigrate passthrough', () => {
    expect(PostgresConfigSchema.parse({ database: 'mydb', autoMigrate: 'safe' }).autoMigrate)
      .toBe('safe');
    expect(() => PostgresConfigSchema.parse({ database: 'mydb', autoMigrate: 'destructive' }))
      .toThrow();
  });
});
