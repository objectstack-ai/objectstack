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
  looksLikeSecretValue,
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
  // one-word stems, header names, folded compounds
  'pass', 'pw', 'pat', 'authorization', 'x-auth-token', 'Proxy-Authorization', 'set-cookie', 'service_account_json',
  'dbpassword', 'secretaccesskey', 'passwordhash',
] as const;

/** Spellings that must NOT be judged credential-shaped. */
const NOT_CREDENTIAL_SHAPED = [
  // ordinary connection configuration
  'host', 'port', 'database', 'username', 'user', 'region', 'warehouse', 'schema', 'ssl', 'oauth', 'pattern',
  // `…key` that is not key material, and the identity halves of a pair
  'primaryKey', 'partitionKey', 'sortKey', 'cacheKey', 'idempotencyKey', 'accessKey', 'accessKeyId', 'clientId',
  'tenantId',
  // words that merely contain a stem
  'passive', 'bypass', 'bypassCache', 'passThrough', 'cookieDomain', 'tokenTtl', 'compass', 'author', 'authorName',
  'tokenizer', 'keyspace', 'secretary', 'credentialing',
  // a stem already ending in `s` takes no plural `s`
  'sass', 'compileSass',
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
    ['scheme-relative userinfo', '//u:p@h/db'],
    ['stacked-scheme userinfo', 'jdbc:postgresql://u:p@h/db'],
    ['Oracle thin userinfo', 'jdbc:oracle:thin:scott/tiger@//h:1521/svc'],
    ['libpq unquoted `;` in a password', 'host=h password=a;b'],
    ['URL userinfo with `;` in the password', 'sqlserver://u:a;b=c@h/db'],
    ['URL tail property whose value holds `@`', 'sqlserver://h;password=a@b;databaseName=d'],
    ['URL tail property whose value holds `:` and `@`', 'sqlserver://h;password=a:b@c'],
    ['query pair holding `;`', 'https://h/x?token=a;b'],
    ['query pair whose `;` run carries a credential', 'https://h/x?mode=ro;password=p'],
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
    ['a stacked-scheme URL with no userinfo', 'jdbc:postgresql://h/db?ssl=true'],
    ['an Oracle thin URL with no userinfo', 'jdbc:oracle:thin:@//h:1521/svc'],
    ['a scheme-relative URL with no userinfo', '//h/db'],
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

  it.each([
    ['Server=h;Password=SEK;RIT=a;b;Database=d', 'Server=h;Database=d'],
    ['Password=SEK;RIT;Server=h', 'Server=h'],
    ['host=h password=SEK;RIT dbname=d', 'host=h dbname=d'],
    ["host=h password='SEK RIT' dbname=d", 'host=h dbname=d'],
    ['sqlserver://u:SEK;RIT=x@h:1433;databaseName=d', 'sqlserver://u@h:1433;databaseName=d'],
    ['sqlserver://h;password=SEK;RIT=x;databaseName=d', 'sqlserver://h;databaseName=d'],
    ['sqlserver://h;password=SEK@RIT;databaseName=d', 'sqlserver://h;databaseName=d'],
    ['sqlserver://h;password=SEK:RIT@x;databaseName=d', 'sqlserver://h;databaseName=d'],
    ['https://h/x?token=SEK;RIT&mode=ro', 'https://h/x?mode=ro'],
    ['https://h/x?mode=ro;password=SEKRIT#f', 'https://h/x#f'],
    ['//u:SEKRIT@h/db', '//u@h/db'],
    ['jdbc:mysql://u:SEKRIT@h/db?useSSL=true', 'jdbc:mysql://u@h/db?useSSL=true'],
    ['jdbc:oracle:thin:scott/SEKRIT@//h:1521/svc', 'jdbc:oracle:thin:scott@//h:1521/svc'],
  ])('an unquoted credential holding `;`, `=`, `:` or `@` leaves no tail: %s', (value, expected) => {
    expect(embeddedCredentialOf(value)).toBeDefined();
    const out = redactEmbeddedCredentials(value);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/SEK|RIT/);
    // What the read door serves is itself credential-free: the write door accepts it back.
    expect(embeddedCredentialOf(out)).toBeUndefined();
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

  // A bare `key` is narrowed by its value (pinned in its own block below).
  it.each(CREDENTIAL_SHAPED.filter((key) => key !== 'key'))('refuses a non-empty %s, at its own path', (key) => {
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

  it('a credential-shaped key inside array data is refused — array data is no longer off the walk', () => {
    // Inverts the earlier pin that accepted `seed: [{ password: 'row-data' }]`.
    expect(refusals({ seed: [{ password: 'row-data' }] })).toEqual(['config.seed.0.password']);
  });

  it('refuses the value of a `[name, value]` header tuple naming a credential, and only that', () => {
    expect(
      refusals({ headers: [['Authorization', 'Bearer t'], ['Cookie', 'sid=1'], ['Accept', 'application/json']] }).sort(),
    ).toEqual(['config.headers.0.1', 'config.headers.1.1']);
    expect(refusals({ pairs: [['token', '']], range: ['password', 'x'] })).toEqual([]);
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
        libpqSemicolon: 'host=h password=a;b',
        oracle: 'jdbc:oracle:thin:scott/tiger@//h:1521/svc',
      }),
    ).toEqual([
      'config.url', 'config.dsn', 'config.jdbc', 'config.connectionString', 'config.libpq', 'config.target',
      'config.libpqSemicolon', 'config.oracle',
    ]);
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
  tuples: [['Authorization', 'Bearer t2'], ['Accept', 'application/json']],
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
      tuples: [['Authorization'], ['Accept', 'application/json']],
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
      'tuples.0.1',
      'url',
    ]);
    expect(JSON.stringify(config)).not.toMatch(/"k"|k1|"cs"|"sa"|p1|Bearer|Password=p|password=p|u:p@/);
  });

  it('withholds a subtree too deep to judge — the same position the write door refuses', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 20; i += 1) deep = { n: deep };
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, { host: 'h', deep });
    expect(redactedKeys).toHaveLength(1);
    expect(['config', ...(redactedKeys[0] as string).split('.')].join('.')).toEqual(refusals({ host: 'h', deep })[0]);
    expect(JSON.stringify(config)).not.toContain('leaf');
  });

  it('an array element withheld before its siblings is nulled, never shifting them; one at the end is spliced', () => {
    // Twenty nested `[inner, 'sib']` pairs: the walk's depth cap lands on an
    // `inner` that has a sibling after it.
    let nested: unknown = ['x', 'sib'];
    for (let i = 0; i < 20; i += 1) nested = [nested, 'sib'];
    const { config, redactedPaths } = redactDatasourceConfig(DRIVER, { list: nested });
    expect(redactedPaths).toHaveLength(1);
    let node = (config as { list: unknown }).list;
    let levels = 0;
    while (Array.isArray(node)) {
      expect(node).toHaveLength(2);
      expect(node[1]).toBe('sib');
      node = node[0];
      levels += 1;
    }
    expect(node).toBeNull();
    expect(levels).toBe((redactedPaths[0] as readonly string[]).length - 1);
    // A withheld element at the END of its array is spliced.
    const tail = redactDatasourceConfig(DRIVER, { headers: [['Accept', 'json'], ['Authorization', 'Bearer t']] });
    expect(tail.config).toEqual({ headers: [['Accept', 'json'], ['Authorization']] });
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

// ---------------------------------------------------------------------------
// Round 3: bounded judgment, lenient parses, header shapes, key names,
// embedded shapes, context, bytes, and the bare `key`.
// ---------------------------------------------------------------------------

/** Wall-clock milliseconds one call takes. */
function elapsed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('the judgment is linear and bounded: an over-long key is judged conservatively', () => {
  const CAPITALS = 'A'.repeat(100_000);

  it('a 100 KB run of capitals is judged fast — as a key, a segment key, a pair label, a header name', () => {
    expect(elapsed(() => isCredentialShapedConfigKey(CAPITALS))).toBeLessThan(2000);
    expect(elapsed(() => findContractlessCredentials({ [CAPITALS]: 'x', [`${CAPITALS}b`]: 'y' }))).toBeLessThan(2000);
    expect(elapsed(() => embeddedCredentialOf(`${CAPITALS}=v`))).toBeLessThan(2000);
    expect(elapsed(() => embeddedCredentialOf(`${CAPITALS}: v`))).toBeLessThan(2000);
    expect(elapsed(() => embeddedCredentialOf(`https://h/x?${CAPITALS}=v`))).toBeLessThan(2000);
  });

  it('a long libpq string is parsed in one pass', () => {
    expect(elapsed(() => embeddedCredentialOf('k=v '.repeat(50_000)))).toBeLessThan(2000);
    expect(elapsed(() => embeddedCredentialOf('x '.repeat(50_000)))).toBeLessThan(2000);
  });

  it('a key longer than 256 characters is credential-shaped unread; one within the cap is judged by its words', () => {
    expect(isCredentialShapedConfigKey('A'.repeat(257))).toBe(true);
    expect(isCredentialShapedConfigKey('host'.repeat(70))).toBe(true);
    expect(isCredentialShapedConfigKey('A'.repeat(256))).toBe(false);
    expect(isCredentialShapedConfigKey(CAPITALS)).toBe(true);
    expect(refusals({ [CAPITALS]: 'x' })).toEqual([`config.${CAPITALS}`]);
    // A connection-string segment key, too.
    expect(embeddedCredentialOf(`${'X'.repeat(300)}=v`)).toBeDefined();
    expect(embeddedCredentialOf(`${'X'.repeat(200)}=v`)).toBeUndefined();
  });
});

describe('libpq keyword/value pairs are found leniently', () => {
  it.each([
    ['a stray token', 'host=h stray password=p'],
    ['a stray quoted token', "host=h 'quoted stray' password=p"],
    ['a leading word', 'note password=p'],
    ['spaces around `=`', 'host = h password = p'],
    ['an unclosed quote', "host=h password='a b"],
  ])('finds the credential beside %s', (_label, value) => {
    expect(embeddedCredentialOf(value)).toBeDefined();
    expect(connectionStringCredentialKeys(value)).toContain('password');
    expect(redactEmbeddedCredentials(value)).not.toMatch(/password/);
  });

  it('keeps everything else, the stray token included', () => {
    expect(redactEmbeddedCredentials('host=h stray password=p dbname=d')).toBe('host=h stray dbname=d');
    expect(redactEmbeddedCredentials('password=p host=h')).toBe('host=h');
  });

  it.each([
    ['no credential keyword', 'host=h stray dbname=d'],
    ['a credential word as a VALUE', 'mode=password'],
    ['a descriptor keyword', 'mode=ro passwordless=1'],
    ['an empty value', 'host=h password='],
  ])('finds nothing with %s', (_label, value) => {
    expect(embeddedCredentialOf(value)).toBeUndefined();
  });
});

describe('header shapes', () => {
  it('a `Name: value` header line naming a credential is found and loses its value', () => {
    expect(embeddedCredentialOf('Authorization: Bearer t')).toBeDefined();
    expect(embeddedCredentialOf('X-Api-Key:k')).toBeDefined();
    expect(redactEmbeddedCredentials('Accept: json\r\nAuthorization: Bearer t')).toBe('Accept: json\r\nAuthorization:');
    expect(refusals({ headers: ['Authorization: Bearer t', 'Accept: json'] })).toEqual(['config.headers.0']);
  });

  it('a header line naming no credential, or with no value, is not', () => {
    expect(embeddedCredentialOf('Content-Type: application/json')).toBeUndefined();
    expect(embeddedCredentialOf('Authorization:')).toBeUndefined();
    expect(embeddedCredentialOf('note: see the runbook')).toBeUndefined();
  });

  it('a flat raw-headers list under a header-ish key: each credential name\'s value', () => {
    expect(refusals({ headers: ['Authorization', 'Bearer t', 'Accept', 'json', 'Cookie', 'sid=1'] })).toEqual([
      'config.headers.1',
      'config.headers.5',
    ]);
    expect(refusals({ rawHeaders: ['Accept', 'token', 'X-Kind', 'v'] })).toEqual([]);
  });

  it('a flat list under a key that is not header-ish is plain data', () => {
    expect(refusals({ tags: ['token', 'profile'], scopes: ['password', 'email'] })).toEqual([]);
  });

  it('a tuple directly under a header-ish key, and a tuple longer than two', () => {
    expect(refusals({ header: ['Authorization', 'Bearer t'] })).toEqual(['config.header.1']);
    expect(refusals({ list: [['Authorization', 'Bearer', 't']] }).sort()).toEqual(['config.list.0.1', 'config.list.0.2']);
    expect(refusals({ list: [['Accept', 'json', 'xml']] })).toEqual([]);
  });

  it('every label key of a pair is judged — `{ key: \'Authorization\', value }` holds its secret in `value`', () => {
    expect(
      refusals({
        headers: [
          { key: 'Authorization', value: 'Bearer t' },
          { name: 'h1', key: 'X-Api-Key', value: 'k' },
          { header: 'Accept', name: 'Cookie', value: 'sid=1' },
          { key: 'Accept', value: 'json' },
        ],
      }).sort(),
    ).toEqual(['config.headers.0.value', 'config.headers.1.value', 'config.headers.2.value']);
  });

  it('a pair label is still judged for an embedded credential', () => {
    expect(refusals({ list: [{ name: 'https://u:p@h/x', value: 'v' }] })).toEqual(['config.list.0.name']);
  });
});

describe('key names: TLS key material, `privkey`, trailing qualifiers, normalisation', () => {
  it.each([
    'sslKey', 'tlsKey', 'ssl_key', 'SSL-Key', 'sslkey', 'tlskey', 'privkey', 'sslPrivkey', 'privateKeyData',
    'tokenString', 'tokenStr', 'authData', 'encryptionKeyHex', 'pwdHash', 'apiKeyRaw', 'secretContent', 'basicauth',
    'bearerauth',
    // full-width `password`, read as `password` after NFKC
    'ｐａｓｓｗｏｒｄ',
    // a key holding non-ASCII letters (Cyrillic), or a zero-width character inside a word
    'пароль',
    'pass​word',
  ])('%j is credential-shaped', (key) => {
    expect(isCredentialShapedConfigKey(key)).toBe(true);
    expect(refusals({ [key]: 'cleartext-value' })).toEqual([`config.${key}`]);
  });

  it.each(['sslMode', 'tlsVersion', 'sslCert', 'rawData', 'userData', 'contentType', 'metadata', 'dataSource', 'hashAlgorithm', 'oauth', 'keyspace'])(
    '%j is not credential-shaped',
    (key) => {
      expect(isCredentialShapedConfigKey(key)).toBe(false);
    },
  );
});

describe('embedded credentials: token usernames, signatures, JSON, form encoding, fragments', () => {
  const TOKEN = 'ghp_16C7e42F292c6912E7710c838347Ae178B4a';

  it.each([
    ['a token-shaped URL username with no password', `https://${TOKEN}@github.com/o/r.git`, 'https://github.com/o/r.git'],
    ['a token-shaped username with an empty password', `https://${TOKEN}:@github.com/o/r.git`, 'https://github.com/o/r.git'],
    ['a `sig` query parameter', 'https://a.blob.core.windows.net/c?sv=2020&sig=abc%3D', 'https://a.blob.core.windows.net/c?sv=2020'],
    ['an `X-Amz-Signature` query parameter', 'https://b.s3.amazonaws.com/k?X-Amz-Date=1&X-Amz-Signature=abc', 'https://b.s3.amazonaws.com/k?X-Amz-Date=1'],
    ['a JSON-encoded object', '{"apiKey":"k","host":"h"}', '{"host":"h"}'],
    ['a JSON-encoded header list', '[{"name":"Authorization","value":"Bearer t"}]', '[{"name":"Authorization"}]'],
    ['a JSON-encoded connection string', '{"dsn":"postgres://u:p@h/db"}', '{"dsn":"postgres://u@h/db"}'],
    ['a form-encoded string', 'a=b&pass=c', 'a=b'],
    ['a form-encoded string with a leading `?`', '?client_secret=s&grant_type=x', '?grant_type=x'],
    ['a `#password=` fragment', 'https://h/x#password=p', 'https://h/x'],
    ['an implicit-grant fragment', 'https://h/cb#access_token=t&state=s', 'https://h/cb#state=s'],
  ])('finds and strips %s', (_label, value, expected) => {
    expect(embeddedCredentialOf(value)).toBeDefined();
    const out = redactEmbeddedCredentials(value);
    expect(out).toBe(expected);
    expect(embeddedCredentialOf(out)).toBeUndefined();
  });

  it.each([
    ['a plain URL username', 'https://deploy@github.com/o/r.git'],
    ['an email-shaped URL username', 'https://ops%40example.com@h/x'],
    ['an ordinary query', 'https://h/x?signal=1&design=2'],
    ['a JSON object with no credential', '{"host":"h","port":5432}'],
    ['a JSON-looking string that does not parse', '{not json, password=p'],
    ['a form-encoded string with no credential', 'a=b&c=d'],
    ['a fragment that is an anchor', 'https://h/docs#section-2'],
  ])('finds nothing in %s', (_label, value) => {
    // (The JSON-looking string that does not parse is judged by the other readings.)
    if (value.startsWith('{not')) {
      expect(embeddedCredentialOf(value)).toBeDefined();
      return;
    }
    expect(embeddedCredentialOf(value)).toBeUndefined();
    expect(redactEmbeddedCredentials(value)).toBe(value);
  });

  it('the write and read doors agree on a JSON-encoded config value', () => {
    const stored = { options: '{"auth":{"user":"u","password":"p"},"timeoutMs":5}' };
    expect(refusals(stored)).toEqual(['config.options']);
    const { config } = redactDatasourceConfig(DRIVER, stored);
    expect(JSON.parse((config as { options: string }).options)).toEqual({ auth: { user: 'u' }, timeoutMs: 5 });
    expect(refusals(config)).toEqual([]);
  });

  it('a JSON-encoded value nested past the walk depth is not accepted unjudged', () => {
    let nested = '"x"';
    for (let i = 0; i < 20; i += 1) nested = JSON.stringify({ n: JSON.parse(nested) });
    expect(embeddedCredentialOf(nested)).toBeDefined();
    expect(embeddedCredentialOf(redactEmbeddedCredentials(nested))).toBeUndefined();
  });
});

describe('a descriptor key does not reset the credential context for an object below it', () => {
  it('an object under a descriptor key inside a credential-shaped object is still judged as credential material', () => {
    expect(refusals({ auth: { source: { value: 'abc' } } })).toEqual(['config.auth.source.value']);
    expect(refusals({ credentials: { provider: { kind: 'gcp', blob: 'xyz' } } })).toEqual([
      'config.credentials.provider.blob',
    ]);
  });

  it('the descriptor exemption still holds for a leaf — and for a list of leaves', () => {
    expect(refusals({ auth: { scopes: ['read', 'write'], type: 'oauth', provider: 'google' } })).toEqual([]);
  });
});

describe('bytes and opaque containers', () => {
  it('bytes under a credential-shaped key are ONE finding, withheld whole', () => {
    expect(refusals({ apiKey: Buffer.from('secret-bytes') })).toEqual(['config.apiKey']);
    const { config, redactedKeys } = redactDatasourceConfig(DRIVER, { host: 'h', privateKey: new Uint8Array([1, 2, 3]) });
    expect(config).toEqual({ host: 'h' });
    expect(redactedKeys).toEqual(['privateKey']);
    expect(refusals({ tokens: [new Uint8Array([1])] })).toEqual(['config.tokens']);
  });

  it('bytes elsewhere are judged by their text, as one value', () => {
    expect(refusals({ blob: new Uint8Array([1, 2, 3]) })).toEqual([]);
    expect(refusals({ blob: Buffer.from('https://u:p@h/x') })).toEqual(['config.blob']);
    expect(redactDatasourceConfig(DRIVER, { blob: Buffer.from('https://u:p@h/x') }).config).toEqual({});
  });

  it('a Map or a Set is not accepted unjudged, and is withheld whole', () => {
    const result = DatasourceSchema.safeParse({ name: 'w', driver: DRIVER, config: { opts: new Map([['a', 1]]) } });
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0]?.message).toContain('Map or a Set');
    expect(refusals({ list: [new Set(['x'])] })).toEqual(['config.list.0']);
    expect(redactDatasourceConfig(DRIVER, { host: 'h', opts: new Map([['password', 'p']]) }).config).toEqual({ host: 'h' });
  });
});

describe('a bare `key` is credential material only where it can be key material', () => {
  it('`{ key: \'email\' }` and other names are accepted', () => {
    expect(
      refusals({ key: 'email', sort: { key: 'created_at', order: 'asc' }, keys: ['email', 'name'], index: { key: 42 } }),
    ).toEqual([]);
  });

  it('a value that looks like a secret, or a credential-shaped or header-ish holder, makes it one', () => {
    expect(refusals({ key: 'sk_live_51HxQ2bL9aZ0rT7yU' })).toEqual(['config.key']);
    expect(refusals({ keys: ['email', 'a3f9c2d17b4e8a6f0c5d9e2b1a7f4c3e'] })).toEqual(['config.keys']);
    expect(refusals({ headers: { key: 'abc' } })).toEqual(['config.headers.key']);
    expect(refusals({ apiKey: { key: 'abc' } })).toEqual(['config.apiKey.key']);
    expect(refusals({ auth: { key: 'abc' } })).toEqual(['config.auth.key']);
  });

  it('elsewhere `key` keeps its full judgment: a query parameter, a connection-string segment', () => {
    expect(isCredentialShapedConfigKey('key')).toBe(true);
    expect(embeddedCredentialOf('https://maps.example.com/api?key=abc')).toBeDefined();
  });

  it('the secret-looking predicate', () => {
    for (const secret of ['sk_live_51HxQ2bL9aZ0rT7yU', 'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY', 'a3f9c2d17b4e8a6f0c5d9e2b1a7f4c3e']) {
      expect(looksLikeSecretValue(secret), secret).toBe(true);
    }
    for (const name of ['email', 'customer_email_2', 'orders.created_at', 'AKIA1234567890', 'two words here please']) {
      expect(looksLikeSecretValue(name), name).toBe(false);
    }
  });
});
