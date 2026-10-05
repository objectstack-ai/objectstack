// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential material in the `config` of a datasource whose driver the
 * platform ships NO contract for.
 *
 * Before: only the canonical spellings (`password`, `authToken`, the former
 * aliases) and URL credentials were withheld on read for such a driver, and
 * nothing was refused at write — so `apiKey`, `client_secret`,
 * `secretAccessKey`, `privateKey`, `accessToken` and a `Password=` segment
 * inside a connection string were stored cleartext and served back on every
 * admin read. Now one predicate (`isCredentialShapedConfigKey`) decides, for
 * both doors: the write door refuses it, the read door withholds it.
 *
 * Every block below also carries the boundary: a driver WITH a contract is
 * judged exactly as before.
 */

import { describe, expect, it } from 'vitest';

import {
  connectionStringCredentialKeys,
  getDriverConfigSchema,
  isCredentialShapedConfigKey,
  redactConnectionStringCredentials,
} from './driver/index';
import { isContractlessDriver, redactDatasourceConfig } from './datasource-credential-redaction';
import { DatasourceSchema } from './datasource.zod';

const DRIVER = 'com.vendor.warehouse';

/** Credential-shaped key spellings, one per pattern family. */
const CREDENTIAL_SHAPED = [
  // the canonical list and its former aliases, still covered
  'password', 'authToken', 'passwd', 'pwd', 'token', 'jwt', 'auth_token',
  // `…password` / `…passwd` / `…passphrase` anywhere
  'dbPassword', 'PASSWORD', 'proxy_passwd', 'sslPassphrase',
  // `…secret…` anywhere
  'clientSecret', 'client_secret', 'Client-Secret', 'secretAccessKey', 'webhookSecret', 'secret',
  // `…credential…` anywhere
  'credentials', 'serviceCredential',
  // `…token` endings
  'accessToken', 'refresh_token', 'sessionToken', 'bearerToken',
  // key material endings
  'apiKey', 'api_key', 'APIKEY', 'privateKey', 'private_key', 'signingKey', 'masterKey',
  'encryptionKey', 'accountKey', 'sharedAccessKey', 'subscriptionKey', 'hmacKey',
  'sharedAccessSignature',
  // `…pwd` ending
  'dbPwd',
] as const;

/** Spellings that must NOT be judged credential-shaped. */
const NOT_CREDENTIAL_SHAPED = [
  // ordinary connection configuration
  'host', 'port', 'database', 'username', 'user', 'region', 'warehouse', 'schema', 'ssl',
  // `…key` that is not key material
  'primaryKey', 'partitionKey', 'sortKey', 'cacheKey', 'idempotencyKey', 'key',
  // identity halves of a credential pair
  'accessKey', 'accessKeyId', 'clientId', 'tenantId',
  // references / locators / descriptors of a credential
  'credentialsRef', 'secretArn', 'secretName', 'passwordFile', 'privateKeyPath', 'tokenUrl',
  'tokenEndpoint', 'passwordEnv', 'tokenType', 'apiKeyHeader', 'tokenPrefix', 'clientSecretId',
  // a count is not a token
  'maxTokens',
  '',
] as const;

describe('isCredentialShapedConfigKey — the one name judgment both doors read', () => {
  it.each(CREDENTIAL_SHAPED)('%s is credential-shaped', (key) => {
    expect(isCredentialShapedConfigKey(key)).toBe(true);
  });

  it.each(NOT_CREDENTIAL_SHAPED)('%j is not credential-shaped', (key) => {
    expect(isCredentialShapedConfigKey(key)).toBe(false);
  });
});

describe('connection-string credential segments', () => {
  it('finds the credential segments of a semicolon-delimited string, case-insensitively', () => {
    expect(connectionStringCredentialKeys('Server=h;User Id=u;Password=p;Database=d')).toEqual(['Password']);
    expect(connectionStringCredentialKeys('server=h;pwd=p')).toEqual(['pwd']);
    expect(connectionStringCredentialKeys('AccountName=a;AccountKey=k==;EndpointSuffix=x')).toEqual(['AccountKey']);
    expect(connectionStringCredentialKeys('Endpoint=sb://h/;SharedAccessKeyName=n;SharedAccessKey=s')).toEqual([
      'SharedAccessKey',
    ]);
  });

  it('carries no segment for a URL, a string with no `=`, or an empty credential value', () => {
    expect(connectionStringCredentialKeys('postgresql://u:p@h/db')).toEqual([]);
    expect(connectionStringCredentialKeys('just a label')).toEqual([]);
    expect(connectionStringCredentialKeys('Server=h;Password=;Database=d')).toEqual([]);
  });

  it('strips exactly the credential segments, keeping the rest byte-for-byte', () => {
    expect(redactConnectionStringCredentials('Server=h;User Id=u;Password=p;Database=d')).toBe(
      'Server=h;User Id=u;Database=d',
    );
    expect(redactConnectionStringCredentials('Password=p;Server=h')).toBe('Server=h');
    expect(redactConnectionStringCredentials('Server=h; Pwd = p ')).toBe('Server=h');
  });

  it('a quoted value is one segment even when it contains `;`', () => {
    expect(redactConnectionStringCredentials('Server=h;Password="a;b""c";Database=d')).toBe('Server=h;Database=d');
    expect(redactConnectionStringCredentials("Server=h;Password='a;b';Database=d")).toBe('Server=h;Database=d');
    expect(redactConnectionStringCredentials('Driver={x};PWD={a;}}b};Database=d')).toBe('Driver={x};Database=d');
  });

  it('an unquoted `;` inside a password takes its trailing fragment with it (no partial leak)', () => {
    const out = redactConnectionStringCredentials('Server=h;Password=ab;cd;Database=d');
    expect(out).toBe('Server=h;Database=d');
    expect(out).not.toContain('cd');
  });

  it('a string with nothing to strip is returned as-is', () => {
    const value = 'Server=h;User Id=u;Database=d;';
    expect(redactConnectionStringCredentials(value)).toBe(value);
  });
});

describe('read door: redactDatasourceConfig for a driver with no shipped contract', () => {
  it('the driver under test has no contract', () => {
    expect(getDriverConfigSchema(DRIVER)).toBeUndefined();
    expect(isContractlessDriver(DRIVER)).toBe(true);
    for (const known of ['postgres', 'mysql', 'mongodb', 'turso', 'sqlite', 'sqlite-wasm', 'memory', 'pg', 'mongo']) {
      expect(isContractlessDriver(known), known).toBe(false);
    }
  });

  it.each(CREDENTIAL_SHAPED)('withholds a top-level %s', (key) => {
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, { host: 'h', [key]: 'cleartext-value' });
    expect(config).toEqual({ host: 'h' });
    expect(redactedKeys).toEqual([key]);
  });

  it('withholds credential-shaped keys at every object depth, and a credential-shaped subtree whole', () => {
    const stored = {
      host: 'h',
      auth: { user: 'u', accessToken: 'at-1' },
      oauth: { clientId: 'cid', clientSecret: 'cs-1' },
      credentials: { type: 'service_account', value: 'sa-1' },
      seed: [{ password: 'row-data' }],
    };
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, stored);
    expect(config).toEqual({
      host: 'h',
      auth: { user: 'u' },
      oauth: { clientId: 'cid' },
      seed: [{ password: 'row-data' }],
    });
    expect(redactedKeys).toEqual(['auth.accessToken', 'credentials', 'oauth.clientSecret']);
    expect(JSON.stringify(config)).not.toMatch(/at-1|cs-1|sa-1/);
  });

  it('strips a `Password=` segment inside a connection string, naming the key', () => {
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, {
      connectionString: 'Server=h;User Id=u;Password=p-1;Database=d',
    });
    expect(config).toEqual({ connectionString: 'Server=h;User Id=u;Database=d' });
    expect(redactedKeys).toEqual(['connectionString']);
  });

  it('still strips URL userinfo passwords and credential query parameters', () => {
    const { config } = redactDatasourceConfig(DRIVER, { url: 'https://u:p-1@h/x?password=q-1&mode=ro' });
    expect(config).toEqual({ url: 'https://u@h/x?mode=ro' });
  });

  it('leaves ordinary configuration — and the reference to a bound secret — alone', () => {
    const stored = { host: 'h', primaryKey: 'id', accessKeyId: 'AKIA1', tokenUrl: 'https://h/t', credentialsRef: 'r' };
    expect(redactDatasourceConfig(DRIVER, stored)).toEqual({ config: stored, redactedKeys: [], redactedPaths: [] });
  });

  it('a driver WITH a contract is judged exactly as before (no name-shape guess layered on)', () => {
    // mongo's `options` passthrough: `apiKey` is no measured client secret and
    // no credential spelling, so it stays served, as it was.
    const mongo = redactDatasourceConfig('mongodb', { url: 'mongodb://h/db', options: { apiKey: 'k' } });
    expect(mongo.config).toEqual({ url: 'mongodb://h/db', options: { apiKey: 'k' } });
    // A connection-string segment scrub is the contractless rule only.
    const pg = redactDatasourceConfig('postgres', { host: 'h', applicationName: 'a=b;Password=c' });
    expect(pg.config).toEqual({ host: 'h', applicationName: 'a=b;Password=c' });
  });
});

/** The DatasourceSchema issues a parse raises, as `[dotted path, code]` pairs. */
function refusals(config: Record<string, unknown>, driver = DRIVER): Array<[string, string]> {
  const result = DatasourceSchema.safeParse({ name: 'warehouse', driver, config });
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.code]);
}

describe('write door: DatasourceSchema refuses inline credentials for a driver with no shipped contract', () => {
  it.each(CREDENTIAL_SHAPED)('refuses a non-empty %s, at its own path', (key) => {
    expect(refusals({ host: 'h', [key]: 'cleartext-value' })).toEqual([[`config.${key}`, 'custom']]);
  });

  it('names the refused position in the message', () => {
    const result = DatasourceSchema.safeParse({ name: 'warehouse', driver: DRIVER, config: { apiKey: 'k' } });
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0]?.message).toContain('`config.apiKey`');
  });

  it('refuses a nested credential, and a string under a credential-shaped object', () => {
    expect(
      refusals({
        auth: { user: 'u', accessToken: 'at' },
        credentials: { type: 'service_account', value: 'sa' },
      }),
    ).toEqual([
      ['config.auth.accessToken', 'custom'],
      ['config.credentials.type', 'custom'],
      ['config.credentials.value', 'custom'],
    ]);
  });

  it('refuses a `Password=` connection-string segment, a URL userinfo password and a credential query parameter', () => {
    expect(
      refusals({
        connectionString: 'Server=h;User Id=u;Password=p;Database=d',
        url: 'https://u:p@h/x',
        dsn: 'https://h/x?password=q',
      }),
    ).toEqual([
      ['config.connectionString', 'custom'],
      ['config.url', 'custom'],
      ['config.dsn', 'custom'],
    ]);
  });

  it('accepts ordinary configuration, an empty credential, non-string values and array data', () => {
    expect(
      refusals({
        host: 'h',
        primaryKey: 'id',
        accessKeyId: 'AKIA1',
        credentialsRef: 'r',
        password: '',
        usePassword: true,
        tokenTtl: 3600,
        url: 'https://u@h/x?mode=ro',
        connectionString: 'Server=h;User Id=u;Database=d',
        seed: [{ password: 'row-data' }],
      }),
    ).toEqual([]);
  });

  it('accepts a `${…}` environment placeholder (no credential material), but not a literal beside one', () => {
    expect(
      refusals({
        apiKey: '${API_KEY}',
        connectionString: 'Server=h;Password=${DB_PASSWORD}',
        url: 'https://u:${PW}@h/x',
      }),
    ).toEqual([]);
    expect(refusals({ apiKey: 'sk-live-${SUFFIX}' })).toEqual([['config.apiKey', 'custom']]);
  });

  it('accepts exactly what the read door serves back (an untouched round trip saves)', () => {
    const stored = {
      host: 'h',
      apiKey: 'k',
      oauth: { clientId: 'cid', clientSecret: 'cs' },
      connectionString: 'Server=h;Password=p',
      url: 'https://u:p@h/x',
    };
    expect(refusals(stored).length).toBeGreaterThan(0);
    expect(refusals(redactDatasourceConfig(DRIVER, stored).config)).toEqual([]);
  });

  it('the write door refuses every string position the read door withholds (one predicate, two doors)', () => {
    const stored = {
      apiKey: 'k',
      nested: { client_secret: 's', note: 'Server=h;Pwd=p' },
      privateKey: 'pk',
      host: 'h',
    };
    const { redactedKeys } = redactDatasourceConfig(DRIVER, stored);
    expect(refusals(stored).map(([path]) => path).sort()).toEqual(redactedKeys.map((key) => `config.${key}`).sort());
  });

  it('a driver WITH a contract is judged exactly as before', () => {
    // postgres: the contract refuses `password` (z.never) and is strict.
    const pg = DatasourceSchema.safeParse({ name: 'pg', driver: 'postgres', config: { host: 'h', password: 'p' } });
    expect(pg.success).toBe(false);
    expect(pg.success ? [] : pg.error.issues.map((issue) => issue.message)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('ships no config contract')]),
    );
    // mongo's passthrough still accepts a key no measured client reads as a secret.
    expect(refusals({ url: 'mongodb://h/db', options: { apiKey: 'k' } }, 'mongodb')).toEqual([]);
  });
});
