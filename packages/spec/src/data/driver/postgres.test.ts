import { describe, it, expect } from 'vitest';
import { DatasourceSchema } from '../datasource.zod';
import { MongoConfigSchema } from './mongo.zod';
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

  it('refuses config with environment variable patterns — placeholders are not resolved here (#8336)', () => {
    // INVERTED acceptance pin. This test used to pin (#7990 census) that
    // placeholder-shaped strings PARSE for non-credential keys — recording the
    // measured fact that nothing resolves them and they reach the client
    // verbatim. The #8336 ruling (direction 2, 2026-08-13) closed that door:
    // same input, opposite verdict. The family pins live in
    // driver-placeholder-refusal.test.ts; this inversion keeps the historical
    // fixture judged rather than deleted.
    const result = PostgresConfigSchema.safeParse({
      database: '${DB_NAME}',
      host: '${DB_HOST}',
      username: '${DB_USER}',
    });

    expect(result.success).toBe(false);
    const paths = result.error!.issues
      .filter((i) => i.message.includes('placeholders are not resolved here'))
      .map((i) => i.path.join('.'));
    expect(paths.sort()).toEqual(['database', 'host', 'username']);
  });

  it('accepts the dev-only autoMigrate passthrough', () => {
    expect(PostgresConfigSchema.parse({ database: 'mydb', autoMigrate: 'safe' }).autoMigrate)
      .toBe('safe');
    expect(() => PostgresConfigSchema.parse({ database: 'mydb', autoMigrate: 'destructive' }))
      .toThrow();
  });
});

/**
 * #9091 — a `url` that `pg` itself cannot parse is refused at publish.
 *
 * The describe text always documented the postgres URL grammar; until #9091
 * the value was only string-scanned (credentials #8082/#8337, placeholders
 * #8336) because the SHARED helper's refusal to parse is load-bearing for
 * mongo's multi-host/`+srv` forms (#8696). The parse question is asked
 * per-driver, of `pg`'s own parser (`pg-connection-string`).
 *
 * Envelope note (the standing minimum for rejection pins): the zod issue's
 * `code` and its (re-pathed) location are the whole envelope at this layer —
 * `status` does not exist here; the publish door wraps every schema refusal
 * uniformly (metadata-protocol's `422 INVALID_METADATA`, whose `issues[]`
 * carry these zod codes verbatim).
 */
describe('PostgresConfigSchema.url pg-grammar enforcement (#9091)', () => {
  it("refuses libpq's multi-host DSN — the form `pg` measurably cannot open", () => {
    // Measured on pg@8.22.0 / pg-connection-string@2.14.0: both `parse` and
    // `ConnectionParameters` throw `TypeError [ERR_INVALID_URL]` on this exact
    // value. It parsed green here until #9091.
    const result = PostgresConfigSchema.safeParse({
      url: 'postgresql://app@h1:5432,h2:5433/app',
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'url');
    expect(issue, 'refusal must land at `url`').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('not a connection URL `pg` can open');
    // The message names the common cause and its working replacements.
    expect(issue!.message).toContain('multi-host');
    // The runtime-DSN carve-out, stated rather than implied (family convention).
    expect(issue!.message).toContain('OS_DATABASE_URL');
  });

  it('re-paths the refusal at `config.url` through the datasource door', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { url: 'postgresql://app@h1:5432,h2:5433/app' },
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.url');
    expect(issue, 'refusal must be re-pathed at `config.url`').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('not a connection URL `pg` can open');
  });

  it('refuses a non-numeric port — `pg` throws ERR_INVALID_URL on it', () => {
    const result = PostgresConfigSchema.safeParse({
      url: 'postgresql://db.example.com:notaport/app',
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'url');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('not a connection URL `pg` can open');
  });

  it('refuses a scheme-less non-URL — `pg` would resolve it against a placeholder host', () => {
    // `pg-connection-string` parses these via `new URL(str, 'postgres://base')`,
    // so they do NOT throw: pg would connect to the literal host `base` with
    // the authored text as the database name. Structurally unusable, refused.
    for (const url of ['not a url at all', 'host=localhost dbname=app']) {
      const result = PostgresConfigSchema.safeParse({ url });

      expect(result.success, url).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'url');
      expect(issue, `refusal for ${url} must land at \`url\``).toBeDefined();
      expect(issue!.code).toBe('custom');
      expect(issue!.message).toContain('no scheme');
      expect(issue!.message).toContain('`base`');
    }
  });

  it('refuses the fs-reading query parameters, pointing at the datasource-level `ssl` block', () => {
    // `?sslcert=`/`?sslkey=`/`?sslrootcert=` make `parse` itself call
    // `fs.readFileSync` — a publish verdict must not depend on the validating
    // host's filesystem, and certificate material already has its declared
    // home (the same prescription the config-level `ca`/`cert`/`key` keys
    // carry).
    const result = PostgresConfigSchema.safeParse({
      url: 'postgresql://db.example.com/app?sslcert=/etc/ssl/client.pem',
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'url');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('?sslcert=');
    expect(issue!.message).toContain('datasource-level `ssl` block');
  });

  it('mirrors `pg` exactly on the fs-param boundary: exact-case, non-empty value', () => {
    // Measured: `?SSLCERT=` is copied into the parsed config and read by
    // nothing (no fs touch), and an empty `?sslcert=` is falsy at the
    // parser's guard (no fs touch) — refusing either would narrow past what
    // `pg` does. Both stay accepted.
    for (const url of [
      'postgresql://db.example.com/app?SSLCERT=/etc/ssl/client.pem',
      'postgresql://db.example.com/app?sslcert=',
    ]) {
      const result = PostgresConfigSchema.safeParse({ url });
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it('reports the parse refusal ALONGSIDE the credential refusal on a value violating both', () => {
    // Composition pin: independent superRefines judge one value, each
    // reporting its own finding (#8082 userinfo + #9091 grammar here).
    const result = PostgresConfigSchema.safeParse({
      url: 'postgresql://user:pass@h1:5432,h2:5433/app',
    });

    expect(result.success).toBe(false);
    const messages = result.error!.issues
      .filter((i) => i.path.join('.') === 'url')
      .map((i) => i.message);
    expect(messages.some((m) => m.includes('embeds a password'))).toBe(true);
    expect(messages.some((m) => m.includes('not a connection URL `pg` can open'))).toBe(true);
  });

  it('accepts every measured shape `pg` genuinely opens', () => {
    for (const url of [
      // The documented single-host forms, credential-free ones included.
      'postgresql://db.example.com/app',
      'postgresql://user@db.example.com:5432/production',
      'postgres://host/db',
      // Empty-host libpq forms (default socket/localhost).
      'postgresql:///dbname',
      'postgresql://user@/mydb',
      // Unix-socket spellings: leading-`/` path, `socket:`, encoded host.
      '/var/run/postgresql',
      'socket:/var/run/postgresql?db=app',
      'postgresql://%2Fvar%2Frun%2Fpostgresql/mydb',
      // IPv6 host and non-credential, non-fs query parameters.
      'postgresql://user@[2001:db8::1]:5432/db',
      'postgresql://db.example.com/app?application_name=objectstack',
    ]) {
      const result = PostgresConfigSchema.safeParse({ url, database: 'app' });
      expect(result.success, `${url}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("leaves mongo's multi-host form untouched — the shared helper's leniency it must keep (#8696)", () => {
    // The #9091 parse check is per-driver BY DESIGN: for mongo the multi-host
    // DSN is a real, working, documented shape. Pin that it still parses.
    const result = MongoConfigSchema.safeParse({
      url: 'mongodb://app@h1:27017,h2:27017/app',
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});
