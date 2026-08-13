// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8336 — `${…}` placeholder syntax is refused across the connection-material
 * driver-config family (maintainer-ruled direction 2, 2026-08-13: refuse
 * loudly at publish; implementing resolution was explicitly rejected).
 *
 * The defect (#7990 census, measured during #8078): a placeholder in authored
 * datasource config is resolved by NOTHING — stored verbatim in
 * `sys_metadata`, handed verbatim to the database client, failing at a
 * distance with no error naming the placeholder. Until this card the syntax
 * looked supported; two shipped refusal messages (#8078, #8082) had to warn
 * around the broken escape instead of pointing through it.
 *
 * Every pin here asserts BOTH directions:
 *
 *   1. a `${…}` span anywhere in a connection-material string value is
 *      refused LOUDLY, pathed at the key, with guidance naming the working
 *      escapes (literal value; secret binder / `external.credentialsRef` for
 *      secret material; runtime-environment DSNs for env-driven deployments);
 *   2. literal values — including strings that merely look placeholder-ish
 *      (`$VAR`, `{name}`, an unclosed `${`) — keep parsing byte-identically.
 *
 * Envelope note (same as the #8082 pins): `status` does not exist at this
 * layer — every schema refusal is wrapped uniformly by the publish door,
 * metadata-protocol's `422 INVALID_METADATA`, whose `issues[]` carry these
 * zod issues verbatim (pinned generically by e.g.
 * `protocol.save-flow-canonicalization.test.ts` asserting
 * `{ code: 'INVALID_METADATA', status: 422 }`). The zod issue's `code` and its
 * path are asserted here, as far as the schema layer carries an envelope.
 */

import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import { containsUnresolvedPlaceholder } from './common.zod';
import { MongoConfigSchema } from './mongo.zod';
import { MysqlConfigSchema } from './mysql.zod';
import { PostgresConfigSchema } from './postgres.zod';
import { SqliteConfigSchema, SqliteWasmConfigSchema } from './sqlite.zod';
import { TursoConfigSchema } from './turso.zod';

/**
 * The family under the ruling: every connection-material STRING key across the
 * driver-config schemas — the keys the shared factory hands to the database
 * client at connect. `valid` is a minimal green config; `literal` is the
 * literal spelling of the judged key (the acceptance pin); `placeholder` is
 * the same key carrying a `${…}` span (the refusal pin). URL samples carry NO
 * userinfo, so the #8082 check cannot be the one firing.
 */
const FAMILY = [
  { name: 'postgres url', schema: PostgresConfigSchema, key: 'url',
    valid: {}, literal: 'postgresql://db.internal:5432/prod', placeholder: 'postgresql://${DB_HOST}:5432/prod' },
  { name: 'postgres host', schema: PostgresConfigSchema, key: 'host',
    valid: { database: 'prod' }, literal: 'db.internal', placeholder: '${DB_HOST}' },
  { name: 'postgres database', schema: PostgresConfigSchema, key: 'database',
    valid: {}, literal: 'prod', placeholder: '${DB_NAME}' },
  { name: 'postgres username', schema: PostgresConfigSchema, key: 'username',
    valid: { database: 'prod' }, literal: 'app', placeholder: '${DB_USER}' },
  { name: 'postgres schema', schema: PostgresConfigSchema, key: 'schema',
    valid: { database: 'prod' }, literal: 'analytics', placeholder: '${DB_SCHEMA}' },
  { name: 'postgres applicationName', schema: PostgresConfigSchema, key: 'applicationName',
    valid: { database: 'prod' }, literal: 'objectstack', placeholder: '${SERVICE_NAME}' },
  { name: 'mysql url', schema: MysqlConfigSchema, key: 'url',
    valid: {}, literal: 'mysql://db.internal:3306/prod', placeholder: 'mysql://${DB_HOST}:3306/prod' },
  { name: 'mysql host', schema: MysqlConfigSchema, key: 'host',
    valid: { database: 'prod' }, literal: 'db.internal', placeholder: '${DB_HOST}' },
  { name: 'mysql database', schema: MysqlConfigSchema, key: 'database',
    valid: {}, literal: 'prod', placeholder: '${DB_NAME}' },
  { name: 'mysql username', schema: MysqlConfigSchema, key: 'username',
    valid: { database: 'prod' }, literal: 'app', placeholder: '${DB_USER}' },
  { name: 'mongo url', schema: MongoConfigSchema, key: 'url',
    valid: {}, literal: 'mongodb://mongo.internal:27017/events', placeholder: 'mongodb://${MONGO_HOST}:27017/events' },
  { name: 'mongo host', schema: MongoConfigSchema, key: 'host',
    valid: { database: 'events' }, literal: 'mongo.internal', placeholder: '${MONGO_HOST}' },
  { name: 'mongo database', schema: MongoConfigSchema, key: 'database',
    valid: {}, literal: 'events', placeholder: '${MONGO_DB}' },
  { name: 'mongo username', schema: MongoConfigSchema, key: 'username',
    valid: { database: 'events' }, literal: 'svc', placeholder: '${MONGO_USER}' },
  { name: 'mongo authSource', schema: MongoConfigSchema, key: 'authSource',
    valid: { database: 'events' }, literal: 'admin', placeholder: '${AUTH_DB}' },
  { name: 'turso url', schema: TursoConfigSchema, key: 'url',
    valid: {}, literal: 'libsql://x.turso.io', placeholder: 'libsql://${TURSO_HOST}' },
  { name: 'turso syncUrl', schema: TursoConfigSchema, key: 'syncUrl',
    valid: { url: 'file:./data/replica.db' }, literal: 'libsql://x.turso.io', placeholder: 'libsql://${TURSO_SYNC_HOST}' },
  { name: 'turso encryptionKey', schema: TursoConfigSchema, key: 'encryptionKey',
    valid: { url: 'file:./data/local.db' }, literal: 'a'.repeat(32), placeholder: '${TURSO_ENCRYPTION_KEY}' },
  { name: 'sqlite filename', schema: SqliteConfigSchema, key: 'filename',
    valid: {}, literal: './data/objectstack.db', placeholder: '${DATA_DIR}/objectstack.db' },
  { name: 'sqlite-wasm filename', schema: SqliteWasmConfigSchema, key: 'filename',
    valid: {}, literal: './data/objectstack.db', placeholder: '${DATA_DIR}/objectstack.db' },
] as const;

describe.each(FAMILY)('$name — unresolved placeholder refusal (#8336)', (f) => {
  it('refuses a `${…}` placeholder, naming the key, the defect and the working escapes', () => {
    const result = f.schema.safeParse({ ...f.valid, [f.key]: f.placeholder });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === f.key);
    expect(issue, `refusal must be pathed at \`${f.key}\``).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain(`\`${f.key}\``);
    // The ruling's guidance, verbatim: the non-capability is explicit.
    expect(issue!.message).toContain('placeholders are not resolved here');
    // The measured defect, in the family's shared phrasing (#8078).
    expect(issue!.message).toContain('resolved by nothing');
    // The working escapes BY NAME — secret binder for secret material …
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    // … and the runtime-environment carve-out for env-driven deployments.
    expect(issue!.message).toContain('OS_DATABASE_URL');
    expect(issue!.message).toContain('unaffected');
  });

  it('accepts the literal spelling byte-identically (pin)', () => {
    const config = { ...f.valid, [f.key]: f.literal };
    const before = f.schema.safeParse(config);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
    expect(f.schema.parse(config)).toEqual(before.data);
  });

  it('placeholder-LOOKING literals stay accepted: `$VAR`, `{name}`, unclosed `${` are not the measured convention', () => {
    // The refusal judges the one convention the census measured — a complete
    // `${…}` span. Widening past it would trade the masked failure for false
    // rejections of legitimate literals (a `$` or brace in a real value).
    for (const nearMiss of [
      f.literal + '$SUFFIX',
      f.literal + '{curly}',
      f.literal + '-${unclosed',
    ]) {
      const result = f.schema.safeParse({ ...f.valid, [f.key]: nearMiss });
      expect(result.success, `\`${nearMiss}\` must stay accepted: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });
});

describe('mongo `options` passthrough — the deep judgement (#8336)', () => {
  const base = { database: 'events', host: 'mongo.internal' };

  it('refuses a `${…}` value at its exact path inside the record', () => {
    const result = MongoConfigSchema.safeParse({
      ...base,
      options: { replicaSet: '${RS_NAME}' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'options.replicaSet');
    expect(issue, 'refusal must be pathed at `options.replicaSet`').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('`options.replicaSet`');
    expect(issue!.message).toContain('placeholders are not resolved here');
  });

  it('judges nested objects and arrays — everything in the record reaches the client', () => {
    const result = MongoConfigSchema.safeParse({
      ...base,
      options: { tls: true, hosts: ['a.internal', '${MONGO_B_HOST}'] },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'options.hosts.1');
    expect(issue, 'refusal must be pathed at `options.hosts.1`').toBeDefined();
  });

  it('accepts a placeholder-free options record byte-identically (pin)', () => {
    const config = {
      ...base,
      options: { replicaSet: 'rs0', tls: true, serverSelectionTimeoutMS: 5000 },
    };
    const before = MongoConfigSchema.safeParse(config);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
    expect(MongoConfigSchema.parse(config)).toEqual(before.data);
  });
});

describe('DatasourceSchema — the refusal reaches the authored artefact (#8336)', () => {
  it('re-paths the refusal under `config.<key>` for the author', () => {
    const result = DatasourceSchema.safeParse({
      name: 'prod',
      driver: 'postgres',
      config: { database: 'prod', host: '${DB_HOST}' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.host');
    expect(issue, 'issue must be re-pathed under config.host').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('placeholders are not resolved here');
  });

  it('a driver with no shipped contract keeps its config unjudged — the honest #4410 boundary', () => {
    // A plugin-contributed driver's config is validated against nothing
    // (config-registry.zod.ts: "we validate what we can construct"), so a
    // placeholder there is NOT refused — the platform has no schema to judge
    // it against, and inventing a verdict would be worse than the silence.
    const result = DatasourceSchema.safeParse({
      name: 'external_api',
      driver: 'rest_api',
      config: { baseUrl: 'https://api.example.com', apiKey: '${API_KEY}' },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('composition with the #8082 userinfo check', () => {
  it('a URL violating both facts reports both — placeholder AND embedded credential', () => {
    const result = PostgresConfigSchema.safeParse({
      url: 'postgresql://svc:${DB_PASSWORD}@db.internal:5432/prod',
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('placeholders are not resolved here');
    expect(messages).toContain('embeds a password in its userinfo');
  });
});

describe('containsUnresolvedPlaceholder — the shared value-level judgement (#8336)', () => {
  it('matches a complete `${…}` span wherever it sits, whatever it contains', () => {
    expect(containsUnresolvedPlaceholder('${DB_HOST}')).toBe(true);
    expect(containsUnresolvedPlaceholder('postgresql://${DB_HOST}/db')).toBe(true);
    expect(containsUnresolvedPlaceholder('pre-${a b c}-post')).toBe(true);
    expect(containsUnresolvedPlaceholder('${}')).toBe(true);
  });

  it('does not match the near-miss shapes — `$VAR`, `{name}`, unclosed `${`', () => {
    expect(containsUnresolvedPlaceholder('$DB_HOST')).toBe(false);
    expect(containsUnresolvedPlaceholder('{DB_HOST}')).toBe(false);
    expect(containsUnresolvedPlaceholder('db-${unclosed')).toBe(false);
    expect(containsUnresolvedPlaceholder('plain.internal')).toBe(false);
  });
});
