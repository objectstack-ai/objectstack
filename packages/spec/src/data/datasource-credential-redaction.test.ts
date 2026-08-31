// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8300 — the ONE definition of "what is a credential key", moved here from
 * `service-datasource`'s `datasource-config-redaction.ts` (PR #8126).
 *
 * ## The derivation pin — the security-drift guard
 *
 * The first describe block pins, per driver, the EXACT key set the
 * `service-datasource` original derived on the day of the move (byte-equal
 * arrays, insertion order included). #8300's whole reason to exist is that a
 * credential list duplicated across two doors drifts; the move is only safe if
 * the moved module derives what the original derived. Any change to this set —
 * a driver refusing a new key, an alias added or dropped — must be a
 * deliberate edit to this pin, made in the same PR that changes the
 * derivation's inputs, never an accident this test lets through.
 *
 * ## The write-door alignment pin
 *
 * `redactUrlPassword` (read half) and `urlUserinfoPassword` (write half,
 * `driver/common.zod.ts`, #8082) draw the same RFC 3986 userinfo boundaries by
 * design — the write door must refuse precisely the material the read door
 * redacts. While they lived in different packages that claim was comment-only;
 * now both are here, the property block below holds them aligned.
 */

import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import {
  BUILTIN_DRIVER_IDS,
  CREDENTIAL_KEY_SPELLINGS,
  CREDENTIAL_URL_QUERY_PARAM_NAMES,
  getDriverConfigSchema,
  urlCredentialQueryParams,
  urlUserinfoPassword,
  urlUserinfoUsername,
} from './driver/index';
import {
  passthroughSecretPaths,
  redactDatasourceConfig,
  redactUrlCredentialQueryParams,
  redactUrlCredentials,
  redactUrlPassword,
  redactableConfigKeys,
  refusedCredentialKeys,
  refusedCredentialPaths,
  refusedCredentialPathsOfSchema,
  refusedPassthroughSecretPaths,
} from './datasource-credential-redaction';

/** The pre-#8078 alias spellings — the hand-written half of the definition. */
const ALIASES = ['passwd', 'pwd', 'token', 'jwt', 'auth_token', 'authtoken'];

describe('derivation pin: the moved module derives EXACTLY what the service-datasource original derived', () => {
  it('z.never() derivation, per driver with a shipped contract', () => {
    expect(refusedCredentialKeys('postgres')).toEqual(['password']);
    expect(refusedCredentialKeys('mysql')).toEqual(['password']);
    expect(refusedCredentialKeys('mongodb')).toEqual(['password']);
    expect(refusedCredentialKeys('turso')).toEqual(['authToken']);
    // Credential-less drivers declare none, and must not acquire one by accident.
    expect(refusedCredentialKeys('sqlite')).toEqual([]);
    expect(refusedCredentialKeys('sqlite-wasm')).toEqual([]);
    expect(refusedCredentialKeys('memory')).toEqual([]);
    // No contract ⇒ no derived verdict (the fallback below covers the names).
    expect(refusedCredentialKeys('not-a-real-driver')).toEqual([]);
  });

  it('full redactable set, byte-equal per driver (the #8300 drift guard)', () => {
    // These literals ARE the pin: they reproduce, key for key and in order,
    // what `service-datasource`'s `redactableConfigKeys` answered on
    // origin/main at the move. Changing them is changing the platform's
    // credential-redaction surface — do it deliberately, with the driver
    // contract change that motivates it, never as clean-up.
    expect(redactableConfigKeys('postgres')).toEqual(['password', ...ALIASES]);
    expect(redactableConfigKeys('mysql')).toEqual(['password', ...ALIASES]);
    expect(redactableConfigKeys('mongodb')).toEqual(['password', ...ALIASES]);
    expect(redactableConfigKeys('turso')).toEqual(['authToken', ...ALIASES, 'encryptionKey']);

    // A driver whose contract refuses nothing — or that ships no contract at
    // all — falls back to BOTH canonical spellings by name: the registry is
    // saying "nothing to check against", not "nothing to protect".
    const fallback = ['password', 'authToken', ...ALIASES];
    expect(redactableConfigKeys('sqlite')).toEqual(fallback);
    expect(redactableConfigKeys('sqlite-wasm')).toEqual(fallback);
    expect(redactableConfigKeys('memory')).toEqual(fallback);
    expect(redactableConfigKeys('not-a-real-driver')).toEqual(fallback);
    // A non-string driver value cannot index the still-writable table, and
    // must not throw — a stored row's `driver` is whatever was stored.
    expect(redactableConfigKeys(undefined)).toEqual(fallback);
  });

  it('every z.never() key across every builtin driver is covered by the unknown-driver fallback', () => {
    // Guards the one hand-written canonical list: if a driver refuses a NEW
    // credential key, the fallback used for contract-less drivers must learn
    // it too, or an unknown driver's config would serve that spelling in
    // cleartext. Same invariant the service-datasource suite pins through the
    // re-export — held here at the source as well, so it cannot be lost to a
    // consumer-side test reshuffle.
    const declared = new Set<string>();
    for (const id of BUILTIN_DRIVER_IDS as readonly string[]) {
      for (const key of refusedCredentialKeys(id)) declared.add(key);
    }
    expect(declared.size).toBeGreaterThan(0);
    const fallback = new Set(redactableConfigKeys('a-driver-with-no-contract'));
    for (const key of declared) expect(fallback.has(key)).toBe(true);
  });
});

describe('redactDatasourceConfig — the read-path scrub, at its new home', () => {
  it('drops stored credential keys and rewrites URL-embedded passwords, naming both', () => {
    const { config, redactedKeys } = redactDatasourceConfig('postgres', {
      host: 'db.internal',
      database: 'app',
      username: 'admin',
      password: 'hunter2',
      url: 'postgresql://admin:hunter2@db.internal:5432/app',
    });
    expect(config).toEqual({
      host: 'db.internal',
      database: 'app',
      username: 'admin',
      url: 'postgresql://admin@db.internal:5432/app',
    });
    expect(redactedKeys).toEqual(['password', 'url']);
  });

  it('is pure — the stored record object is never mutated', () => {
    const stored = { host: 'h', password: 'hunter2' };
    const { config } = redactDatasourceConfig('postgres', stored);
    expect(stored).toEqual({ host: 'h', password: 'hunter2' });
    expect(config).not.toBe(stored);
  });

  it('a clean config answers redactedKeys: [] — "ran, nothing to hide", not an absence', () => {
    const { config, redactedKeys } = redactDatasourceConfig('postgres', {
      host: 'h',
      database: 'd',
    });
    expect(config).toEqual({ host: 'h', database: 'd' });
    expect(redactedKeys).toEqual([]);
  });

  it('a driver with no shipped contract still has its canonical credentials hidden', () => {
    expect(getDriverConfigSchema('not-a-real-driver')).toBeUndefined();
    const { config, redactedKeys } = redactDatasourceConfig('not-a-real-driver', {
      host: 'h',
      password: 'hunter2',
      authToken: 'jwt',
    });
    expect(config).toEqual({ host: 'h' });
    expect(redactedKeys).toEqual(['authToken', 'password']);
  });
});

describe('write-door alignment: redactUrlPassword removes exactly what urlUserinfoPassword refuses', () => {
  const CARRYING = [
    'postgresql://admin:hunter2@db:5432/app',
    'mongodb://u:p@a.example.com:27017/db?replicaSet=rs0',
    'postgres://u:p@ss@host/db', // malformed literal `@` — judged whole on both sides
    'mysql://u:p@h1:3306,h2:3306/db', // multi-host DSN WHATWG parsing mangles
  ];
  const CREDENTIAL_FREE = [
    'postgresql://admin@db:5432/app',
    'postgresql://db:5432/app',
    'libsql://my-db.turso.io',
    'file:./data/objectstack.db',
    ':memory:',
    'https://host/a:b@c',
    'a:b@c',
  ];

  it('the redacted form of a credential-carrying URL is exactly what the write door accepts', () => {
    for (const url of CARRYING) {
      expect(urlUserinfoPassword(url)).toBeDefined();
      const redacted = redactUrlPassword(url);
      expect(redacted).not.toBe(url);
      // The property #8126 depends on for the legacy-row round trip: the READ
      // door's output must pass the WRITE door, or every untouched "Save"
      // on a legacy row 400s.
      expect(urlUserinfoPassword(redacted)).toBeUndefined();
    }
  });

  it('a URL the write door accepts comes back from the read door byte-for-byte', () => {
    for (const url of CREDENTIAL_FREE) {
      expect(urlUserinfoPassword(url)).toBeUndefined();
      expect(redactUrlPassword(url)).toBe(url);
    }
  });

  it('redaction preserves the USERNAME byte-for-byte — the #8876 half of the same alignment', () => {
    // `urlUserinfoUsername` shares the password half's boundary parse by
    // construction; this pins the redactor to the same grammar from the other
    // side: stripping the password must never move or rewrite the username the
    // #8696 injection path will read off the redacted/stored row.
    for (const url of [...CARRYING, ...CREDENTIAL_FREE]) {
      expect(urlUserinfoUsername(redactUrlPassword(url)), url).toBe(urlUserinfoUsername(url));
    }
  });
});

describe('redactUrlCredentialQueryParams — the #8337 read half', () => {
  it('strips the credential pair whole and serves the parameter-absent shape', () => {
    expect(redactUrlCredentialQueryParams('libsql://x.turso.io?authToken=eyJhbGci.x.y'))
      .toBe('libsql://x.turso.io');
    expect(redactUrlCredentialQueryParams('postgresql://svc@db:5432/app?password=hunter2'))
      .toBe('postgresql://svc@db:5432/app');
  });

  it('preserves benign parameters, their order, and the fragment byte-for-byte', () => {
    expect(redactUrlCredentialQueryParams('libsql://h?tls=1&authToken=x&a=b%20c#frag'))
      .toBe('libsql://h?tls=1&a=b%20c#frag');
    expect(redactUrlCredentialQueryParams('postgresql://db/app?sslmode=require&password=x&connect_timeout=10'))
      .toBe('postgresql://db/app?sslmode=require&connect_timeout=10');
  });

  it('strips the spellings the write door refuses: percent-encoded and case variants', () => {
    expect(redactUrlCredentialQueryParams('libsql://h?auth%54oken=x')).toBe('libsql://h');
    expect(redactUrlCredentialQueryParams('libsql://h?AUTHTOKEN=x')).toBe('libsql://h');
  });

  it('an empty value carries no secret and is left in place — the query twin of `user:@host`', () => {
    for (const url of ['libsql://h?authToken=', 'libsql://h?authToken', 'libsql://h?tls=1', 'libsql://h', ':memory:']) {
      expect(redactUrlCredentialQueryParams(url)).toBe(url);
    }
  });

  it('is name-based and driver-independent — a `?password=` in ANY served string is a leak', () => {
    // The write door refuses only what a measured client reads (mysql's
    // client ignores `?password=`), but the read door strips it anyway: the
    // same asymmetry the module documents for unknown drivers' inline keys.
    expect(redactUrlCredentialQueryParams('mysql://svc@db:3306/app?password=x'))
      .toBe('mysql://svc@db:3306/app');
  });
});

describe('write-door alignment, query half: redactUrlCredentials removes exactly what the doors refuse', () => {
  const QUERY_CARRYING = [
    'libsql://x.turso.io?authToken=eyJhbGci.x.y',
    'libsql://x.turso.io?tls=1&authToken=x',
    'file:./data/db.sqlite?authToken=x',
    'postgresql://svc:hunter2@db:5432/app?password=also', // both syntaxes at once
  ];

  it('the redacted form of a query-carrying URL is exactly what the write door accepts', () => {
    for (const url of QUERY_CARRYING) {
      const redacted = redactUrlCredentials(url);
      expect(redacted).not.toBe(url);
      // Neither door finds anything left: userinfo …
      expect(urlUserinfoPassword(redacted)).toBeUndefined();
      // … and the query half, judged with the same union list the redactor uses.
      expect(urlCredentialQueryParams(redacted, CREDENTIAL_URL_QUERY_PARAM_NAMES)).toEqual([]);
    }
  });

  it('redactDatasourceConfig serves a stored `?authToken=` row parameter-free, naming `url` (the #8337 served-back-cleartext regression)', () => {
    const { config, redactedKeys } = redactDatasourceConfig('turso', {
      url: 'libsql://x.turso.io?authToken=eyJhbGci.x.y',
      syncUrl: 'libsql://x.turso.io?tls=1&authToken=eyJhbGci.x.y',
    });
    expect(config).toEqual({
      url: 'libsql://x.turso.io',
      syncUrl: 'libsql://x.turso.io?tls=1',
    });
    expect(redactedKeys).toEqual(['syncUrl', 'url']);
  });

  it('a driver with no shipped contract still has query-embedded credentials stripped', () => {
    const { config, redactedKeys } = redactDatasourceConfig('not-a-real-driver', {
      url: 'someproto://h/db?password=x&keep=1',
    });
    expect(config).toEqual({ url: 'someproto://h/db?keep=1' });
    expect(redactedKeys).toEqual(['url']);
  });
});

describe('passthrough secret redaction (#9040) — the nested spellings the key-name scrub cannot see', () => {
  const STORED = {
    url: 'mongodb://app@mongo.internal:27017/events',
    options: {
      replicaSet: 'rs0',
      tls: true,
      connectTimeoutMS: 5000,
      auth: { username: 'app', password: 'PLAINTEXT-IN-METADATA' },
    },
  };

  it('drops `options.auth.password`, keeps the username and every benign option, names the dotted path', () => {
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', STORED);
    expect(config).toEqual({
      url: 'mongodb://app@mongo.internal:27017/events',
      options: { replicaSet: 'rs0', tls: true, connectTimeoutMS: 5000, auth: { username: 'app' } },
    });
    expect(redactedKeys).toEqual(['options.auth.password']);
  });

  it('scrubs a stored legacy `driver: "mongo"` row identically — aliases resolve (#6345)', () => {
    const { redactedKeys } = redactDatasourceConfig('mongo', STORED);
    expect(redactedKeys).toEqual(['options.auth.password']);
  });

  it('is pure — the stored input is never mutated', () => {
    const input = JSON.parse(JSON.stringify(STORED));
    redactDatasourceConfig('mongodb', input);
    expect(input).toEqual(STORED);
  });

  it('drops the binder-slotless client secrets too — proxy, TLS key material, AWS session token', () => {
    // Still WRITABLE (the binder has exactly one secret slot — the turso-
    // `encryptionKey` posture), but never SERVED: each is honoured (or, for
    // AWS_SESSION_TOKEN, refused loudly) by mongodb@7.5.0, so serving it back
    // is a leak under any boundary.
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', {
      options: {
        replicaSet: 'rs0',
        proxyHost: 'proxy.internal',
        proxyUsername: 'svc',
        proxyPassword: 'sekret',
        tlsCertificateKeyFilePassword: 'passphrase',
        key: '-----BEGIN PRIVATE KEY-----',
        passphrase: 'p',
        authMechanismProperties: { AWS_SESSION_TOKEN: 'tok', SERVICE_NAME: 'mongodb' },
      },
    });
    expect(config).toEqual({
      options: {
        replicaSet: 'rs0',
        proxyHost: 'proxy.internal',
        proxyUsername: 'svc',
        authMechanismProperties: { SERVICE_NAME: 'mongodb' },
      },
    });
    expect(redactedKeys).toEqual([
      'options.authMechanismProperties.AWS_SESSION_TOKEN',
      'options.key',
      'options.passphrase',
      'options.proxyPassword',
      'options.tlsCertificateKeyFilePassword',
    ]);
  });

  it('drops CSFLE `kmsProviders` key material in every family, keeps the identity halves', () => {
    // Measured against mongodb@7.5.0 BOTH ways the optional
    // `mongodb-client-encryption` dependency can go: with it installed (7.2.1,
    // inside the pin's ^7.2.0 optional-peer range) an instrumented constructor
    // reads every one of these leaves (BSON-serialized into the native
    // MongoCrypt); without it the same construction throws
    // MongoMissingDependencyError before reading any of them. Either way a
    // stored copy is decryption-capable material served in cleartext — the
    // AWS_SESSION_TOKEN posture.
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', {
      url: 'mongodb://app@mongo.internal:27017/events',
      options: {
        replicaSet: 'rs0',
        autoEncryption: {
          keyVaultNamespace: 'encryption.__keyVault',
          kmsProviders: {
            aws: { accessKeyId: 'AKIAFAKEFAKEFAKEFAKE', secretAccessKey: 'AWS-SECRET', sessionToken: 'AWS-SESSION' },
            azure: { tenantId: 'tenant-id', clientId: 'client-id', clientSecret: 'AZURE-SECRET' },
            gcp: { email: 'svc@example.iam.gserviceaccount.com', privateKey: 'R0NQLUtFWQ==' },
            local: { key: 'TE9DQUwtS0VZ' },
          },
        },
      },
    });
    expect(config).toEqual({
      url: 'mongodb://app@mongo.internal:27017/events',
      options: {
        replicaSet: 'rs0',
        autoEncryption: {
          keyVaultNamespace: 'encryption.__keyVault',
          kmsProviders: {
            // The identity halves the client also reads are NOT credential
            // material (#8876's asymmetry) and stay served.
            aws: { accessKeyId: 'AKIAFAKEFAKEFAKEFAKE' },
            azure: { tenantId: 'tenant-id', clientId: 'client-id' },
            gcp: { email: 'svc@example.iam.gserviceaccount.com' },
            local: {},
          },
        },
      },
    });
    expect(redactedKeys).toEqual([
      'options.autoEncryption.kmsProviders.aws.secretAccessKey',
      'options.autoEncryption.kmsProviders.aws.sessionToken',
      'options.autoEncryption.kmsProviders.azure.clientSecret',
      'options.autoEncryption.kmsProviders.gcp.privateKey',
      'options.autoEncryption.kmsProviders.local.key',
    ]);
  });

  it('unmeasured `autoEncryption` neighbours stay served — the table is measurement-only', () => {
    // Negative control for the CSFLE rows: positions the measurement did NOT
    // establish as secret material (`kmip.endpoint`, `keyVaultNamespace`,
    // `schemaMap`, `bypassAutoEncryption`) are not on the table, mirror no
    // credential spelling, and come back byte-identical — the discipline that
    // entries land only with a measurement quoted, never by name-shape.
    const table = passthroughSecretPaths('mongodb').map((p) => p.join('.'));
    expect(table).not.toContain('options.autoEncryption.kmsProviders.kmip.endpoint');
    expect(table).not.toContain('options.autoEncryption.keyVaultNamespace');
    const stored = {
      options: {
        autoEncryption: {
          keyVaultNamespace: 'encryption.__keyVault',
          bypassAutoEncryption: false,
          schemaMap: { 'appdb.people': { bsonType: 'object' } },
          kmsProviders: { kmip: { endpoint: 'kmip.internal:5696' } },
        },
      },
    };
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', stored);
    expect(config).toEqual(stored);
    expect(redactedKeys).toEqual([]);
  });

  it('a config without the passthrough — or with a malformed one — is untouched', () => {
    expect(redactDatasourceConfig('mongodb', { database: 'events' }).redactedKeys).toEqual([]);
    // Off-shape walks fall off silently rather than throwing on a stored row.
    expect(redactDatasourceConfig('mongodb', { options: 'not-a-record' }).redactedKeys).toEqual([]);
    expect(redactDatasourceConfig('mongodb', { options: { auth: 'not-a-record' } }).redactedKeys)
      .toEqual([]);
  });

  it('other drivers have no passthrough today — measured, not assumed', () => {
    // postgres/mysql/turso/sqlite/memory ship closed strict-object contracts
    // with no client-bound record slot; a nested `password` there is an
    // unknown key the write door refuses, not a served secret.
    for (const driver of ['postgres', 'mysql', 'turso', 'sqlite', 'sqlite-wasm', 'memory']) {
      expect(passthroughSecretPaths(driver), driver).toEqual([]);
    }
    expect(passthroughSecretPaths('mongodb').length).toBeGreaterThan(0);
    expect(passthroughSecretPaths('not-a-real-driver')).toEqual([]);
  });

  it('the write-door subset projects the refusal list — the two doors cannot drift', () => {
    expect(refusedPassthroughSecretPaths('mongodb')).toEqual([['options', 'auth', 'password']]);
    expect(refusedPassthroughSecretPaths('mongo')).toEqual([['options', 'auth', 'password']]);
    expect(refusedPassthroughSecretPaths('postgres')).toEqual([]);
    // Every write-door-refused path must be read-door-redacted: a refusal the
    // scrub does not mirror would serve back the very material the write door
    // calls a secret.
    const redacted = new Set(passthroughSecretPaths('mongodb').map((p) => p.join('.')));
    for (const path of refusedPassthroughSecretPaths('mongodb')) {
      expect(redacted.has(path.join('.'))).toBe(true);
    }
  });
});

/**
 * The nested-position class — the finding this suite exists to hold closed.
 *
 * Before the fix, the credential-name judgment ran at the TOP level only and
 * the nested side was ONLY the hand-enumerated `passthroughSecretPaths` table:
 * a credential under the very spelling the top level hides, one object level
 * down, was served back cleartext with `redactedKeys: []` (measured on the
 * pre-fix build: `options.auth.token`, `options.pool.password`,
 * `tunnel.password` on a contract-less driver, and a nested URL userinfo
 * password all leaked). Every case below is a position deliberately ABSENT
 * from that table — the mandated non-empty control: regression cases against
 * table paths were already green and prove nothing about this class.
 */
describe('nested credential positions OFF the passthrough table — the class control', () => {
  it('mongodb: drops a nested credential SPELLING the table does not list (`options.auth.token`)', () => {
    expect(passthroughSecretPaths('mongodb').map((p) => p.join('.')))
      .not.toContain('options.auth.token');
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', {
      database: 'app',
      options: { auth: { username: 'svc', token: 'eyJhbGci.x.y' }, replicaSet: 'rs0' },
    });
    expect(config).toEqual({
      database: 'app',
      options: { auth: { username: 'svc' }, replicaSet: 'rs0' },
    });
    expect(redactedKeys).toEqual(['options.auth.token']);
  });

  it('mongodb: drops a credential spelling nested one level deeper than the table knows', () => {
    expect(passthroughSecretPaths('mongodb').map((p) => p.join('.')))
      .not.toContain('options.pool.password');
    const { config, redactedKeys } = redactDatasourceConfig('mongodb', {
      database: 'app',
      options: { pool: { password: 'hunter2', min: 1 } },
    });
    expect(config).toEqual({ database: 'app', options: { pool: { min: 1 } } });
    expect(redactedKeys).toEqual(['options.pool.password']);
  });

  it('a contract-less driver has nested credential spellings hidden too — no table row exists at all', () => {
    expect(passthroughSecretPaths('com.vendor.custom')).toEqual([]);
    const { config, redactedKeys } = redactDatasourceConfig('com.vendor.custom', {
      endpoint: 'x',
      tunnel: { password: 'hunter2', host: 'bastion' },
    });
    expect(config).toEqual({ endpoint: 'x', tunnel: { host: 'bastion' } });
    expect(redactedKeys).toEqual(['tunnel.password']);
  });

  it('a NESTED string value gets the same URL composite the top level gets', () => {
    const { config, redactedKeys } = redactDatasourceConfig('com.vendor.custom', {
      replication: { url: 'postgresql://svc:hunter2@replica/db', lag: 5 },
    });
    expect(config).toEqual({
      replication: { url: 'postgresql://svc@replica/db', lag: 5 },
    });
    expect(redactedKeys).toEqual(['replication.url']);
  });

  it('`redactedPaths` carries the same removals as exact segments, index-aligned', () => {
    const { redactedKeys, redactedPaths } = redactDatasourceConfig('mongodb', {
      password: 'top',
      options: { auth: { token: 'nested' } },
    });
    expect(redactedKeys).toEqual(['options.auth.token', 'password']);
    expect(redactedPaths).toEqual([['options', 'auth', 'token'], ['password']]);
  });

  it('is pure at depth — the nested containers of the stored input are never mutated', () => {
    const stored = {
      options: { auth: { username: 'svc', token: 'eyJ' }, pool: { password: 'x' } },
    };
    const snapshot = JSON.parse(JSON.stringify(stored));
    redactDatasourceConfig('mongodb', stored);
    expect(stored).toEqual(snapshot);
  });

  it('arrays are OFF the walk — row-shaped data keeps its own `password` FIELD (the seed carve-out, structurally)', () => {
    // memory's `initialData` holds rows the driver SERVES; a scrub that
    // reached into them would corrupt data, which is not this module's
    // question. The boundary is structural (arrays end the walk — the same
    // line the write door's `valueAtPath` draws), so it needs no per-driver
    // exclusion list.
    const stored = {
      initialData: { users: [{ name: 'u1', password: 'seed-row-value' }] },
    };
    const { config, redactedKeys } = redactDatasourceConfig('memory', stored);
    expect(config).toEqual(stored);
    expect(redactedKeys).toEqual([]);
  });
});

/**
 * The DERIVED nested refusals — "reading the schema is reading the refusal
 * list", extended below the top level. No builtin driver declares a nested
 * `z.never()` today (pinned per driver below, measured not assumed), so the
 * nested branch is proved against a constructed schema.
 */
describe('refusedCredentialPaths — the schema derivation, walked at depth', () => {
  it('finds a nested z.never() leaf in an object shape, at its exact path', () => {
    const schema = z.object({
      host: z.string(),
      proxy: z.object({
        host: z.string(),
        secretToken: z.never().optional(),
      }).optional(),
    });
    expect(refusedCredentialPathsOfSchema(schema)).toEqual([['proxy', 'secretToken']]);
  });

  it('depth-1 projection equals refusedCredentialKeys for every builtin driver — and no driver declares deeper refusals today', () => {
    for (const id of BUILTIN_DRIVER_IDS as readonly string[]) {
      const paths = refusedCredentialPaths(id);
      expect(paths.map((p) => p.join('.')), id).toEqual(refusedCredentialKeys(id));
      expect(paths.every((p) => p.length === 1), id).toBe(true);
    }
    expect(refusedCredentialPaths('not-a-real-driver')).toEqual([]);
  });

  it('the ONE spelling list both doors consume covers canonical + aliases, and the read fallback carries all of it', () => {
    // `CREDENTIAL_KEY_SPELLINGS` (driver/common.zod.ts) is what the write
    // door's passthrough walk refuses; the read path's name set must hide at
    // least those spellings at every depth, or the doors disagree about a
    // nested position — the drift #8300 exists to prevent.
    const fallback = new Set(redactableConfigKeys('a-driver-with-no-contract'));
    for (const name of CREDENTIAL_KEY_SPELLINGS) {
      expect(fallback.has(name), name).toBe(true);
    }
  });
});
