// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential material in the `config` of a datasource whose driver the
 * platform ships NO contract for.
 *
 * One walk (`findContractlessCredentials`, `driver/contractless-credentials.ts`)
 * decides for both doors: the write door refuses every position it reports,
 * the read door withholds every one. Each block pins a judgment in both
 * directions; the last ones pin that a driver WITH a contract is judged
 * exactly as before.
 */

import { describe, expect, it } from 'vitest';

import {
  connectionStringCredentialKeys,
  embeddedCredentialOf,
  findContractlessCredentials,
  getDriverConfigSchema,
  isCredentialShapedConfigKey,
  redactEmbeddedCredentials,
} from './driver/index';
import { isContractlessDriver, redactDatasourceConfig } from './datasource-credential-redaction';
import { DatasourceSchema } from './datasource.zod';

const DRIVER = 'com.vendor.warehouse';

/** Credential-shaped key spellings, one or more per rule. */
const CREDENTIAL_SHAPED = [
  // the canonical list and its former aliases
  'password', 'authToken', 'passwd', 'pwd', 'token', 'jwt', 'auth_token', 'authtoken',
  // words that count anywhere
  'dbPassword', 'PASSWORD', 'proxy_passwd', 'sslPassphrase', 'clientSecret', 'client_secret',
  'Client-Secret', 'secretAccessKey', 'webhookSecret', 'secret', 'credentials', 'serviceCredential',
  // head nouns
  'accessToken', 'refresh_token', 'sessionToken', 'bearerToken', 'dbPass', 'dbPw', 'dbPwd', 'githubPat',
  'sessionCookie', 'cookie', 'sas', 'sasToken', 'auth', 'basicAuth', 'Authorization', 'bearer',
  // key material
  'key', 'apiKey', 'api_key', 'APIKEY', 'X-API-Key', 'privateKey', 'private_key', 'signingKey', 'masterKey',
  'encryptionKey', 'accountKey', 'sharedAccessKey', 'subscriptionKey', 'hmacKey', 'serviceAccountKey',
  'serviceAccountJson', 'sharedAccessSignature',
  // a trailing plural or qualifier
  'apiKeys', 'tokens', 'passwords', 'privateKeyPem', 'apiKeyValue', 'tokenValue', 'keyJson', 'clientSecretValue',
] as const;

/** Spellings that must NOT be judged credential-shaped. */
const NOT_CREDENTIAL_SHAPED = [
  // ordinary connection configuration
  'host', 'port', 'database', 'username', 'user', 'region', 'warehouse', 'schema', 'ssl', 'oauth', 'pattern',
  // `…key` that is not key material, and the identity halves of a pair
  'primaryKey', 'partitionKey', 'sortKey', 'cacheKey', 'idempotencyKey', 'accessKey', 'accessKeyId', 'clientId',
  'tenantId',
  // words that merely contain a stem
  'passive', 'bypass', 'bypassCache', 'passThrough', 'cookieDomain', 'tokenTtl',
  // references, locators, identifiers, descriptors
  'credentialsRef', 'secretArn', 'secretName', 'passwordFile', 'privateKeyPath', 'tokenUrl', 'tokenEndpoint',
  'passwordEnv', 'tokenType', 'apiKeyHeader', 'tokenPrefix', 'clientSecretId', 'secretsManagerRegion',
  'credentialProvider', 'credentialSource', 'credentialChain', 'passwordPolicy', 'authMethod', 'passwordEnabled',
  'passwordAuthentication', 'passwordless',
  // flags and measures
  'useDefaultCredentials', 'usePassword', 'requirePassword', 'maxTokens',
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

describe('embedded credentials in a string value', () => {
  it.each([
    ['URL userinfo', 'postgresql://u:p@h/db'],
    ['URL query parameter by name', 'https://h/x?api_key=k'],
    ['URL `;key=value` tail', 'sqlserver://h:1433;user=u;password=p'],
    ['semicolon connection string', 'Server=h;User Id=u;Password=p;Database=d'],
    ['Azure account key segment', 'AccountName=a;AccountKey=k==;EndpointSuffix=x'],
    ['libpq keyword/value', 'host=h port=5432 password=p'],
    ['libpq quoted value', "host=h password='a b'"],
    ['scheme-less userinfo', 'u:p@h/db'],
  ])('finds %s', (_label, value) => {
    expect(embeddedCredentialOf(value)).toBeDefined();
  });

  it.each([
    ['a plain URL', 'https://u@h/x?mode=ro'],
    ['an empty URL password', 'https://u:@h/x'],
    ['a URL tail with no credential', 'sqlserver://h;databaseName=d'],
    ['a connection string with no credential', 'Server=h;User Id=u;Database=d;'],
    ['an empty password segment', 'Server=h;Password=;Database=d'],
    ['libpq with no credential', 'host=h port=5432 dbname=d'],
    ['an email address', 'ops@example.com'],
    ['a label', 'just a label'],
  ])('finds nothing in %s', (_label, value) => {
    expect(embeddedCredentialOf(value)).toBeUndefined();
    expect(redactEmbeddedCredentials(value)).toBe(value);
  });

  it('names the credential segment keys of each connection-string form', () => {
    expect(connectionStringCredentialKeys('Server=h;Password=p')).toEqual(['Password']);
    expect(connectionStringCredentialKeys('host=h password=p')).toEqual(['password']);
    expect(connectionStringCredentialKeys('sqlserver://h;user=u;password=p')).toEqual(['password']);
  });

  it('strips exactly the credential, keeping the rest', () => {
    expect(redactEmbeddedCredentials('Server=h;User Id=u;Password=p;Database=d')).toBe('Server=h;User Id=u;Database=d');
    expect(redactEmbeddedCredentials('sqlserver://u:x@h:1433;user=u;password=p;databaseName=d')).toBe(
      'sqlserver://u@h:1433;user=u;databaseName=d',
    );
    expect(redactEmbeddedCredentials('host=h password=p dbname=d')).toBe('host=h dbname=d');
    expect(redactEmbeddedCredentials("host=h password='a b' dbname=d")).toBe('host=h dbname=d');
    expect(redactEmbeddedCredentials('u:p@h/db')).toBe('u@h/db');
    expect(redactEmbeddedCredentials('https://h/x?access_token=t&mode=ro#f')).toBe('https://h/x?mode=ro#f');
  });

  it('a quoted value is one segment even when it contains `;`', () => {
    expect(redactEmbeddedCredentials('Server=h;Password="a;b""c";Database=d')).toBe('Server=h;Database=d');
    expect(redactEmbeddedCredentials('Driver={x};PWD={a;}}b};Database=d')).toBe('Driver={x};Database=d');
  });

  it('an unquoted password containing `;` and `=` takes its whole tail with it (no partial leak)', () => {
    const out = redactEmbeddedCredentials('Server=h;Password=ab;cd=ef;gh;Database=d');
    expect(out).toBe('Server=h;Database=d');
    expect(out).not.toMatch(/cd|ef|gh/);
  });
});

/** The DatasourceSchema issues a parse raises, as dotted paths (every one a `custom` refusal). */
function refusals(config: Record<string, unknown>, driver = DRIVER): string[] {
  const result = DatasourceSchema.safeParse({ name: 'warehouse', driver, config });
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    expect(issue.code).toBe('custom');
    return issue.path.join('.');
  });
}

describe('write door: DatasourceSchema refuses inline credentials for a driver with no shipped contract', () => {
  it('the driver under test has no contract; every builtin does', () => {
    expect(getDriverConfigSchema(DRIVER)).toBeUndefined();
    expect(isContractlessDriver(DRIVER)).toBe(true);
    for (const known of ['postgres', 'mysql', 'mongodb', 'turso', 'sqlite', 'sqlite-wasm', 'memory', 'pg', 'mongo']) {
      expect(isContractlessDriver(known), known).toBe(false);
    }
  });

  it.each(CREDENTIAL_SHAPED)('refuses a non-empty %s, at its own path', (key) => {
    expect(refusals({ host: 'h', [key]: 'cleartext-value' })).toEqual([`config.${key}`]);
  });

  it('names the refused position in the message', () => {
    const result = DatasourceSchema.safeParse({ name: 'warehouse', driver: DRIVER, config: { apiKey: 'k' } });
    expect(result.success ? '' : result.error.issues[0]?.message).toContain('`config.apiKey`');
  });

  it('refuses credentials inside array elements, judged by key', () => {
    expect(
      refusals({
        servers: [{ host: 'a', password: 'p1' }, { host: 'b', port: 1 }],
        headers: [
          { name: 'Authorization', value: 'Bearer t' },
          { name: 'X-API-Key', value: 'k' },
          { name: 'Accept', value: 'application/json' },
        ],
        hosts: ['https://u:p@h/x', 'https://h/y'],
      }).sort(),
    ).toEqual(['config.headers.0.value', 'config.headers.1.value', 'config.hosts.0', 'config.servers.0.password']);
  });

  it('control: plain row data in an array is accepted', () => {
    expect(refusals({ seed: [{ name: 'a', amount: 1 }, { name: 'b', amount: 2 }], tags: ['x', 'y'] })).toEqual([]);
  });

  it('a credential-shaped object: its secret leaves are refused, its descriptors and identities are not', () => {
    expect(refusals({ credentials: { type: 'service_account', clientId: 'cid' } })).toEqual([]);
    expect(refusals({ credentials: { type: 'service_account', value: 'sa' } })).toEqual(['config.credentials.value']);
    expect(refusals({ auth: { user: 'u', accessToken: 'at' } })).toEqual(['config.auth.accessToken']);
    expect(refusals({ oauth: { clientId: 'cid', client_secret: 's' } })).toEqual(['config.oauth.client_secret']);
  });

  it('refuses a number and an array of values under a credential-shaped key; a boolean is a flag', () => {
    expect(refusals({ pin: 1, password: 1234, apiKeys: ['k1', 'k2'] }).sort()).toEqual([
      'config.apiKeys',
      'config.password',
    ]);
    expect(refusals({ password: true, secret: false, apiKeys: [], token: null })).toEqual([]);
  });

  it('refuses a subtree too deep to judge instead of skipping it', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 20; i += 1) deep = { n: deep };
    const found = refusals({ host: 'h', deep });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^config\.deep(\.n)+$/);
  });

  it('refuses credentials embedded in strings — URL, URL tail, connection strings, scheme-less userinfo', () => {
    expect(
      refusals({
        url: 'https://u:p@h/x',
        dsn: 'https://h/x?password=q',
        jdbc: 'sqlserver://h;user=u;password=p',
        connectionString: 'Server=h;Password=p',
        libpq: 'host=h password=p',
        target: 'u:p@h/db',
      }),
    ).toEqual(['config.url', 'config.dsn', 'config.jdbc', 'config.connectionString', 'config.libpq', 'config.target']);
  });

  it('accepts an environment-name placeholder in place of a value — and only that grammar', () => {
    expect(
      refusals({
        apiKey: '${API_KEY}',
        token: '${A}${B_2}',
        connectionString: 'Server=h;Password=${DB_PASSWORD}',
        url: 'https://u:${PW}@h/x',
      }),
    ).toEqual([]);
    expect(
      refusals({ apiKey: 'sk-live-${SUFFIX}', secret: '${lower_case}', token: '${API_KEY:-fallback}' }).sort(),
    ).toEqual(['config.apiKey', 'config.secret', 'config.token']);
  });

  it('accepts ordinary configuration and an empty credential', () => {
    expect(
      refusals({
        host: 'h',
        primaryKey: 'id',
        accessKeyId: 'AKIA1',
        credentialsRef: 'r',
        secretsManagerRegion: 'eu-west-1',
        useDefaultCredentials: true,
        maxTokens: 4096,
        password: '',
        url: 'https://u@h/x?mode=ro',
        connectionString: 'Server=h;User Id=u;Database=d',
      }),
    ).toEqual([]);
  });

  it('a driver WITH a contract is judged exactly as before', () => {
    const pg = DatasourceSchema.safeParse({ name: 'pg', driver: 'postgres', config: { host: 'h', password: 'p' } });
    expect(pg.success).toBe(false);
    expect(pg.success ? [] : pg.error.issues.map((issue) => issue.message)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('ships no config contract')]),
    );
    expect(refusals({ url: 'mongodb://h/db', options: { apiKey: 'k' } }, 'mongodb')).toEqual([]);
  });
});

/** A stored contractless config exercising every finding kind. */
const STORED = {
  host: 'h',
  apiKey: 'k',
  pin: 1234,
  apiKeys: ['k1', 'k2'],
  oauth: { clientId: 'cid', client_secret: 'cs' },
  credentials: { type: 'service_account', value: 'sa' },
  servers: [{ host: 'a', password: 'p1' }, { host: 'b' }],
  headers: [{ name: 'Authorization', value: 'Bearer t' }, { name: 'Accept', value: 'application/json' }],
  connectionString: 'Server=h;User Id=u;Password=p;Database=d',
  libpq: 'host=h password=p dbname=d',
  url: 'https://u:p@h/x?mode=ro',
  seed: [{ name: 'a', amount: 1 }],
  useDefaultCredentials: true,
};

describe('read door: redactDatasourceConfig for a driver with no shipped contract', () => {
  it('withholds every finding, array elements included, and keeps everything else', () => {
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, STORED);
    expect(config).toEqual({
      host: 'h',
      pin: 1234,
      oauth: { clientId: 'cid' },
      credentials: { type: 'service_account' },
      servers: [{ host: 'a' }, { host: 'b' }],
      headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'application/json' }],
      connectionString: 'Server=h;User Id=u;Database=d',
      libpq: 'host=h dbname=d',
      url: 'https://u@h/x?mode=ro',
      seed: [{ name: 'a', amount: 1 }],
      useDefaultCredentials: true,
    });
    expect(redactedKeys).toEqual([
      'apiKey',
      'apiKeys',
      'connectionString',
      'credentials.value',
      'headers.0.value',
      'libpq',
      'oauth.client_secret',
      'servers.0.password',
      'url',
    ]);
    expect(JSON.stringify(config)).not.toMatch(/"k"|k1|"cs"|"sa"|p1|Bearer|Password=p|password=p|u:p@/);
  });

  it('the input is never mutated', () => {
    const before = JSON.stringify(STORED);
    redactDatasourceConfig(DRIVER, STORED);
    expect(JSON.stringify(STORED)).toBe(before);
  });

  it('one walk, two doors: the write door refuses what the read door withholds, and accepts what it serves', () => {
    const refused = refusals(STORED).sort();
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, STORED);
    expect(refused).toEqual(redactedKeys.map((key) => `config.${key}`).sort());
    expect(refused).toEqual(findContractlessCredentials(STORED).map((f) => ['config', ...f.path].join('.')).sort());
    expect(refusals(config)).toEqual([]);
  });

  it('leaves ordinary configuration — and the reference to a bound secret — alone', () => {
    const stored = { host: 'h', primaryKey: 'id', accessKeyId: 'AKIA1', tokenUrl: 'https://h/t', credentialsRef: 'r' };
    expect(redactDatasourceConfig(DRIVER, stored)).toEqual({ config: stored, redactedKeys: [], redactedPaths: [] });
  });

  it('a driver WITH a contract is judged exactly as before (no name-shape guess layered on)', () => {
    const mongo = redactDatasourceConfig('mongodb', { url: 'mongodb://h/db', options: { apiKey: 'k' } });
    expect(mongo.config).toEqual({ url: 'mongodb://h/db', options: { apiKey: 'k' } });
    const pg = redactDatasourceConfig('postgres', { host: 'h', applicationName: 'a=b;Password=c' });
    expect(pg.config).toEqual({ host: 'h', applicationName: 'a=b;Password=c' });
  });
});
