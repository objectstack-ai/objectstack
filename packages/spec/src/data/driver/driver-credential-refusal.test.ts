// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7990 — inline credentials are refused across the driver-config family
 * (maintainer-ruled Option A, 2026-08-12: per-artefact contract closure).
 * #8082 — the same closure for URL-embedded credentials (`user:password@host`
 * in `config.url`), the one-syntax-over workaround #8078 measured and pinned
 * as a fact; that acceptance pin is INVERTED below, per the 2026-08-12 ruling.
 *
 * `sys_metadata.metadata` is reachable through the ordinary data API, and a
 * datasource is persisted whole — so a credential the schema ACCEPTS inline is
 * a credential stored in cleartext. Every pin here asserts BOTH directions the
 * ruling names:
 *
 *   1. the inline form is refused LOUDLY, with guidance naming the mechanisms
 *      that already exist (`sys_secret` via the datasource secret binder;
 *      `external.credentialsRef`) — never a bare `unrecognized_keys`;
 *   2. the ref-based and credential-free forms keep parsing BYTE-IDENTICALLY.
 *
 * Plus the projection contract that makes the refusal safe to ship: the Studio
 * connection form renders its SECRET input from the `format: 'password'`
 * marker in the driver's JSON-Schema projection and routes the value to the
 * top-level `secret` (the binder's door). The refused key must keep that
 * marker, or the wizard loses the very input the refusal diverts authors to.
 */

import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import {
  CREDENTIAL_URL_QUERY_PARAMS,
  urlCredentialQueryParams,
  urlUserinfoPassword,
  urlUserinfoUsername,
} from './common.zod';
import {
  getMongoConfigJsonSchema,
  MongoConfigSchema,
} from './mongo.zod';
import { getMysqlConfigJsonSchema, MysqlConfigSchema } from './mysql.zod';
import { getPostgresConfigJsonSchema, PostgresConfigSchema } from './postgres.zod';
import { getTursoConfigJsonSchema, TursoConfigSchema } from './turso.zod';

/** The family under the ruling: schema, its credential key, a minimal valid config. */
const FAMILY = [
  {
    driver: 'postgres',
    key: 'password',
    schema: PostgresConfigSchema,
    jsonSchema: getPostgresConfigJsonSchema,
    valid: { database: 'prod', host: 'db.internal', username: 'app' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'mysql',
    key: 'password',
    schema: MysqlConfigSchema,
    jsonSchema: getMysqlConfigJsonSchema,
    valid: { database: 'prod', host: 'db.internal', username: 'app' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'mongo',
    key: 'password',
    schema: MongoConfigSchema,
    jsonSchema: getMongoConfigJsonSchema,
    valid: { database: 'events', host: 'mongo.internal', username: 'svc' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'turso',
    key: 'authToken',
    schema: TursoConfigSchema,
    jsonSchema: getTursoConfigJsonSchema,
    valid: { url: 'libsql://x.turso.io' },
    formerAliases: ['token', 'jwt', 'auth_token', 'authtoken'],
  },
] as const;

describe.each(FAMILY)('$driver — inline credential refusal (#7990)', (f) => {
  it(`refuses an inline \`${f.key}\`, naming the key's replacement mechanisms`, () => {
    const result = f.schema.safeParse({ ...f.valid, [f.key]: 'hunter2' });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === f.key);
    expect(issue, `refusal must be pathed at \`${f.key}\``).toBeDefined();
    // The ADR-named mechanisms, BY NAME — the message is the migration doc for
    // whoever hits it (very often an AI author).
    expect(issue!.message).toContain(`\`${f.key}\``);
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
  });

  it('refuses a placeholder value exactly like a real one — the KEY is the sink', () => {
    // `${…}` placeholders are resolved by nothing (measured, #7990 census):
    // they were stored verbatim in `sys_metadata` and connected verbatim.
    const result = f.schema.safeParse({ ...f.valid, [f.key]: '${DB_PASSWORD}' });
    expect(result.success).toBe(false);
  });

  it.each([...f.formerAliases])(
    'former alias spelling `%s` carries the refusal directly (no two-step rename)',
    (alias) => {
      const result = f.schema.safeParse({ ...f.valid, [alias]: 'hunter2' });
      expect(result.success).toBe(false);
      const text = JSON.stringify(result.error!.issues);
      expect(text).toContain('external.credentialsRef');
      expect(text).toContain('sys_secret');
      // Never a rename hint onto the unwritable key — that is the
      // `triggerPhrase → triggerPhrases` two-step rejection.
      expect(text).not.toContain('Did you mean');
    },
  );

  it('accepts the credential-free config byte-identically (pin)', () => {
    const before = f.schema.safeParse(f.valid);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
    // Parse twice — the output is a pure function of the input, and the parsed
    // value must carry no trace of the refused key.
    const again = f.schema.parse(f.valid);
    expect(again).toEqual(before.data);
    expect(Object.keys(again)).not.toContain(f.key);
  });

  it("keeps the connection form's secret input renderable: `format: 'password'` survives", () => {
    const json = f.jsonSchema() as {
      properties?: Record<string, { format?: string; not?: object }>;
    };
    const prop = json.properties?.[f.key];
    expect(prop, `projection must still declare \`${f.key}\``).toBeDefined();
    // Both halves of the dual role, pinned together: the wizard's marker …
    expect(prop!.format).toBe('password');
    // … and the refusal (z.never emits `{ not: {} }` — also what flags the key
    // `[RETIRED]` in the authorable-surface ratchet).
    expect(prop!.not).toEqual({});
  });
});

describe('DatasourceSchema — the refusal reaches the authored artefact (#7990)', () => {
  it('re-paths the refusal under `config.<key>` for the author', () => {
    const result = DatasourceSchema.safeParse({
      name: 'prod',
      driver: 'postgres',
      config: { database: 'prod', password: 'hunter2' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.password');
    expect(issue, 'issue must be re-pathed under config.password').toBeDefined();
    expect(issue!.message).toContain('external.credentialsRef');
  });

  it('still accepts the ref-based form byte-identically (pin)', () => {
    // The shape the refusal diverts to: secret in the store, opaque handle at
    // `external.credentialsRef` — exactly what the datasource secret binder
    // writes (`sys_secret:<id>`), on a federated datasource.
    const refBased = {
      name: 'warehouse',
      driver: 'postgres',
      schemaMode: 'external',
      config: { database: 'analytics', host: 'wh.internal', username: 'readonly' },
      external: {
        allowWrites: false,
        credentialsRef: 'sys_secret:01J9ZK4T2N',
      },
    } as const;
    const result = DatasourceSchema.safeParse(refBased);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data!.external?.credentialsRef).toBe('sys_secret:01J9ZK4T2N');
    // Byte-identical across parses — the refusal changed nothing on this path.
    expect(DatasourceSchema.parse(refBased)).toEqual(result.data);
  });

  it('query-parameter credentials are REFUSED at `config.url` too (#8337 — the authored artefact door)', () => {
    // Same envelope note as the #8082 pin below: the zod issue's `code` and
    // re-pathed location are the whole envelope at this layer; the publish
    // door wraps every schema refusal uniformly (`422 INVALID_METADATA`).
    const result = DatasourceSchema.safeParse({
      name: 'turso-db',
      driver: 'turso',
      config: { url: 'libsql://x.turso.io?authToken=eyJhbGciOiJFZERTQSJ9.x.y' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.url');
    expect(issue, 'refusal must be re-pathed at `config.url`').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('?authToken=');
    expect(issue!.message).toContain('external.credentialsRef');
  });

  it('embedded-in-URL credentials are REFUSED at `config.url` (#8082 — the inverted #8078 pin)', () => {
    // This test used to pin the ACCEPTANCE of exactly this input as a measured
    // fact (#7990 open question). The 2026-08-12 #8082 ruling (Option A)
    // closed the door, so the pin inverts rather than disappears: same input,
    // opposite verdict, and the verdict's envelope is asserted as far as the
    // schema layer carries one — the zod issue's `code` and its re-pathed
    // location. (`status` does not exist at this layer: every schema refusal
    // is wrapped uniformly by the publish door — metadata-protocol's
    // `422 INVALID_METADATA`, whose `issues[]` carry these zod codes verbatim.)
    const result = DatasourceSchema.safeParse({
      name: 'legacy',
      driver: 'postgres',
      config: { url: 'postgresql://user:pass@db.example.com:5432/production' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.url');
    expect(issue, 'refusal must be re-pathed at `config.url`').toBeDefined();
    expect(issue!.code).toBe('custom');
    // The migration doc for whoever hits it: the working mechanisms BY NAME …
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
    // … the explicit runtime-DSN carve-out (maintainer ruling: say it, don't
    // imply it) …
    expect(issue!.message).toContain('OS_DATABASE_URL');
    expect(issue!.message).toContain('unaffected');
    // … and NO steering toward the broken `${…}` escape: the message may only
    // mention placeholders to say they do not work (#8078, measured).
    expect(issue!.message).toContain('resolved by nothing');
  });
});

/** The URL-bearing keys under the #8082 ruling: every driver with a `url`, plus turso's `syncUrl`. */
const URL_FAMILY = [
  {
    name: 'postgres url',
    schema: PostgresConfigSchema,
    key: 'url',
    make: (url: string) => ({ url }),
    sample: (userinfo: string) => `postgresql://${userinfo}db.example.com:5432/prod`,
  },
  {
    name: 'mysql url',
    schema: MysqlConfigSchema,
    key: 'url',
    make: (url: string) => ({ url }),
    sample: (userinfo: string) => `mysql://${userinfo}db.example.com:3306/prod`,
  },
  {
    name: 'mongo url',
    schema: MongoConfigSchema,
    key: 'url',
    make: (url: string) => ({ url }),
    sample: (userinfo: string) => `mongodb://${userinfo}mongo.example.com:27017/events`,
  },
  {
    name: 'turso url',
    schema: TursoConfigSchema,
    key: 'url',
    make: (url: string) => ({ url }),
    sample: (userinfo: string) => `libsql://${userinfo}x.turso.io`,
  },
  {
    name: 'turso syncUrl',
    schema: TursoConfigSchema,
    key: 'syncUrl',
    make: (syncUrl: string) => ({ url: 'file:./data/replica.db', syncUrl }),
    sample: (userinfo: string) => `libsql://${userinfo}x.turso.io`,
  },
] as const;

describe.each(URL_FAMILY)('$name — URL-embedded credential refusal (#8082)', (f) => {
  const refusalAt = (config: Record<string, unknown>) => {
    const result = f.schema.safeParse(config);
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path.join('.') === f.key);
  };

  it('refuses `user:password@host`, naming the replacement mechanisms and the carve-out', () => {
    const issue = refusalAt(f.make(f.sample('svc:hunter2@')));
    expect(issue, `refusal must be pathed at \`${f.key}\``).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain(`\`${f.key}\``);
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
    // The refusal must not recommend the `${…}` placeholder escape — #8078
    // measured it resolves to nothing — and must state the runtime-DSN
    // carve-out rather than leaving it implied (both binding, #8082 ruling).
    expect(issue!.message).toContain('resolved by nothing');
    expect(issue!.message).toContain('OS_DATABASE_URL');
  });

  it('refuses a `${…}` placeholder password exactly like a real one — placeholders resolve to nothing', () => {
    expect(refusalAt(f.make(f.sample('svc:${DB_PASSWORD}@')))).toBeDefined();
  });

  it('refuses a percent-encoded password — encoding is not absence', () => {
    expect(refusalAt(f.make(f.sample('svc:p%40ssw%3Ard@')))).toBeDefined();
  });

  it('refuses a malformed double-`@` password WHOLE (the read-path redactor boundary, RFC 3986)', () => {
    expect(refusalAt(f.make(f.sample('svc:p@ss@')))).toBeDefined();
  });

  it('refuses userinfo in front of an IPv6 host, and accepts the same IPv6 host without one', () => {
    const scheme = f.sample('').split('://')[0];
    expect(refusalAt(f.make(`${scheme}://svc:hunter2@[2001:db8::1]:6543/prod`))).toBeDefined();
    // The bracket colons are host syntax, not a password boundary.
    expect(refusalAt(f.make(`${scheme}://[2001:db8::1]:6543/prod`))).toBeUndefined();
  });

  it('accepts a bare username (`user@host`) — `username` is a writable key, only the secret is refused (#7990 posture)', () => {
    const config = f.make(f.sample('svc@'));
    expect(refusalAt(config)).toBeUndefined();
    const parsed = f.schema.safeParse(config);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('accepts the credential-free URL byte-identically (pin) — including the redacted round-trip shape', () => {
    // `user@host` is exactly what the #8126 read path serves for a legacy
    // stored `user:pass@host` row, and what the Studio edit form PUTs back:
    // this acceptance is what keeps "Save" on an untouched legacy row working.
    for (const userinfo of ['', 'svc@']) {
      const config = f.make(f.sample(userinfo));
      const before = f.schema.safeParse(config);
      expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
      expect(f.schema.parse(config)).toEqual(before.data);
    }
  });
});

/**
 * The query-parameter spelling of the same secret (#8337) — refused only where
 * a MEASURED client reads it: turso `url`/`syncUrl` `?authToken=`
 * (`@libsql/core@0.17.4` assigns it OVER the binder-injected token) and
 * postgres `url` `?password=` (`pg-connection-string@2.14.0` copies every
 * query parameter into the client config, winning over userinfo).
 */
const QUERY_FAMILY = [
  {
    name: 'turso url ?authToken=',
    schema: TursoConfigSchema,
    key: 'url',
    param: 'authToken',
    make: (url: string) => ({ url }),
    sample: (query: string) => `libsql://x.turso.io${query}`,
    benign: '?tls=1',
  },
  {
    name: 'turso syncUrl ?authToken=',
    schema: TursoConfigSchema,
    key: 'syncUrl',
    param: 'authToken',
    make: (syncUrl: string) => ({ url: 'file:./data/replica.db', syncUrl }),
    sample: (query: string) => `libsql://x.turso.io${query}`,
    benign: '?tls=1',
  },
  {
    name: 'postgres url ?password=',
    schema: PostgresConfigSchema,
    key: 'url',
    param: 'password',
    make: (url: string) => ({ url }),
    sample: (query: string) => `postgresql://svc@db.example.com:5432/prod${query}`,
    benign: '?sslmode=require&connect_timeout=10',
  },
] as const;

describe.each(QUERY_FAMILY)('$name — URL query-parameter credential refusal (#8337)', (f) => {
  const refusalAt = (config: Record<string, unknown>) => {
    const result = f.schema.safeParse(config);
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path.join('.') === f.key);
  };

  it(`refuses \`?${f.param}=\`, naming the parameter, the mechanisms and the carve-out`, () => {
    const issue = refusalAt(f.make(f.sample(`?${f.param}=hunter2`)));
    expect(issue, `refusal must be pathed at \`${f.key}\``).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain(`\`${f.key}\``);
    expect(issue!.message).toContain(`?${f.param}=`);
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
    // Same binding constraints as the userinfo message (#8082 ruling): no
    // steering toward the broken `${…}` escape, and the runtime-DSN carve-out
    // stated rather than implied.
    expect(issue!.message).toContain('resolved by nothing');
    expect(issue!.message).toContain('OS_DATABASE_URL');
    expect(issue!.message).toContain('unaffected');
    // What the userinfo message must NOT be copied on: for the query form the
    // bound secret does not reliably win at connect (libsql assigns the URL
    // token over it, measured), so the message must not promise it does.
    expect(issue!.message).not.toContain('wins over');
  });

  it('refuses the parameter wherever it sits among benign ones', () => {
    expect(refusalAt(f.make(f.sample(`${f.benign}&${f.param}=hunter2`)))).toBeDefined();
    expect(refusalAt(f.make(f.sample(`?${f.param}=hunter2&${f.benign.slice(1)}`)))).toBeDefined();
  });

  it('refuses a percent-encoded spelling of the parameter name — encoding is not absence', () => {
    // `@libsql/core` percent-decodes query keys before matching (measured), so
    // an encoded spelling authenticates exactly like the plain one.
    const encoded = `%${f.param.charCodeAt(0).toString(16)}${f.param.slice(1)}`;
    expect(refusalAt(f.make(f.sample(`?${encoded}=hunter2`)))).toBeDefined();
  });

  it('refuses a case-variant spelling — the at-rest half is case-independent', () => {
    // No measured client reads the variant (libsql throws URL_PARAM_NOT_
    // SUPPORTED, pg leaves it an unread config key), so nothing that works is
    // refused — but the secret still landed cleartext in `sys_metadata`.
    expect(refusalAt(f.make(f.sample(`?${f.param.toUpperCase()}=hunter2`)))).toBeDefined();
  });

  it('refuses a `${…}` placeholder value exactly like a real one — placeholders resolve to nothing', () => {
    expect(refusalAt(f.make(f.sample(`?${f.param}=\${DB_TOKEN}`)))).toBeDefined();
  });

  it('accepts an EMPTY value — the query twin of `user:@host` carries no secret', () => {
    expect(refusalAt(f.make(f.sample(`?${f.param}=`)))).toBeUndefined();
  });

  it('accepts benign query parameters byte-identically (pin) — including the redacted round-trip shape', () => {
    // The parameter-absent URL is exactly what the #8337 read path serves for
    // a legacy stored `?authToken=` row, and what the Studio edit form PUTs
    // back: this acceptance keeps "Save" on an untouched legacy row working.
    for (const query of ['', f.benign]) {
      const config = f.make(f.sample(query));
      const before = f.schema.safeParse(config);
      expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
      expect(f.schema.parse(config)).toEqual(before.data);
    }
  });

  it('a fragment is not a query — `#…` content is read by nothing', () => {
    expect(refusalAt(f.make(f.sample(`#${f.param}=hunter2`)))).toBeUndefined();
  });
});

describe('the deliberately-absent entries (#8337) — measured as NOT read, so not refused', () => {
  it('mysql `?password=` stays accepted: mysql2 seeds `password` from userinfo and skips the query key', () => {
    // `mysql2`'s `parseUrl` runs `if (key in options) continue;` over the
    // query, and `password` is always pre-set from userinfo — the parameter
    // never reaches the connection, so refusing it would be the speculative
    // widening the ruling forbids. An author who writes it gets a loud auth
    // failure at connect; the read path still strips it from served configs.
    const result = MysqlConfigSchema.safeParse({ url: 'mysql://svc@db.example.com:3306/prod?password=x' });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('mongo `?password=` stays accepted: the mongodb driver takes credentials from userinfo only', () => {
    const result = MongoConfigSchema.safeParse({ url: 'mongodb://svc@mongo.example.com:27017/events?password=x' });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('urlCredentialQueryParams — the shared value-level parse (#8337)', () => {
  const TURSO = CREDENTIAL_URL_QUERY_PARAMS.turso;

  it('finds the declared parameter with a non-empty value, at any position, once', () => {
    expect(urlCredentialQueryParams('libsql://h?authToken=x', TURSO)).toEqual(['authToken']);
    expect(urlCredentialQueryParams('libsql://h?tls=1&authToken=x&a=1', TURSO)).toEqual(['authToken']);
    expect(urlCredentialQueryParams('libsql://h?authToken=x&authToken=y', TURSO)).toEqual(['authToken']);
    expect(urlCredentialQueryParams('libsql://h?tls=1', TURSO)).toEqual([]);
  });

  it('no `=`, or an empty value, carries no secret', () => {
    expect(urlCredentialQueryParams('libsql://h?authToken', TURSO)).toEqual([]);
    expect(urlCredentialQueryParams('libsql://h?authToken=', TURSO)).toEqual([]);
    expect(urlCredentialQueryParams('libsql://h?authToken=&tls=1', TURSO)).toEqual([]);
  });

  it('the key boundary is the FIRST `=` — a value containing `=` is still the same key', () => {
    expect(urlCredentialQueryParams('libsql://h?authToken=a=b', TURSO)).toEqual(['authToken']);
  });

  it('keys are percent-decoded and `+`-decoded before matching, as the measured clients decode them', () => {
    expect(urlCredentialQueryParams('libsql://h?auth%54oken=x', TURSO)).toEqual(['authToken']);
    // `auth+Token` decodes to `auth Token` — a different name, no match.
    expect(urlCredentialQueryParams('libsql://h?auth+Token=x', TURSO)).toEqual([]);
    // Malformed percent-encoding must not throw inside a parse; the raw
    // spelling cannot name the parameter, and the client throws on it anyway.
    expect(urlCredentialQueryParams('libsql://h?auth%zzoken=x', TURSO)).toEqual([]);
  });

  it('names match case-insensitively (the at-rest rationale on CREDENTIAL_URL_QUERY_PARAMS)', () => {
    expect(urlCredentialQueryParams('libsql://h?AUTHTOKEN=x', TURSO)).toEqual(['authToken']);
    expect(urlCredentialQueryParams('libsql://h?authtoken=x', TURSO)).toEqual(['authToken']);
  });

  it('the query ends at the fragment, and a fragment-only `?` is fragment text', () => {
    expect(urlCredentialQueryParams('libsql://h?tls=1#authToken=x', TURSO)).toEqual([]);
    expect(urlCredentialQueryParams('libsql://h#f?authToken=x', TURSO)).toEqual([]);
    expect(urlCredentialQueryParams('libsql://h?authToken=x#frag', TURSO)).toEqual(['authToken']);
  });

  it('no authority required — libSQL `file:` URLs carry query parameters too', () => {
    expect(urlCredentialQueryParams('file:./data/db.sqlite?authToken=x', TURSO)).toEqual(['authToken']);
    expect(urlCredentialQueryParams(':memory:', TURSO)).toEqual([]);
  });

  it('an empty declared list judges nothing — the non-turso/postgres drivers today', () => {
    expect(urlCredentialQueryParams('mysql://h/db?password=x', [])).toEqual([]);
  });
});

describe('urlUserinfoPassword — the shared value-level parse (#8082)', () => {
  it('judges the DSN forms real drivers take, which `new URL()` rejects or mangles', () => {
    // postgres/mongo multi-host DSNs are not WHATWG URLs; the detector must
    // judge them rather than fail open on a parse error.
    expect(urlUserinfoPassword('postgresql://u:p@h1:5432,h2:5432/db')).toBe('p');
    expect(urlUserinfoPassword('mongodb://u:p@a.example.com:27017,b.example.com:27017/db?replicaSet=rs0')).toBe('p');
    expect(urlUserinfoPassword('postgresql://h1:5432,h2:5432/db')).toBeUndefined();
  });

  it('scheme-relative URLs are judged too — the authority is the authority, named scheme or not', () => {
    expect(urlUserinfoPassword('//u:p@h/db')).toBe('p');
    expect(urlUserinfoPassword('//u@h/db')).toBeUndefined();
  });

  it('userinfo ends at the LAST `@`, so a malformed literal-`@` password is caught whole', () => {
    // Mirrors the read-path redactor's boundary (`redactUrlPassword`, now in
    // this package's `data/datasource-credential-redaction.ts` — #8300): a URL
    // malformed in exactly the way that hides part of a password must not be
    // the case that goes unjudged.
    expect(urlUserinfoPassword('postgres://u:p@ss@host/db')).toBe('p@ss');
  });

  it('a colon or `@` in a path, query or fragment is never userinfo', () => {
    expect(urlUserinfoPassword('https://host/a:b@c')).toBeUndefined();
    expect(urlUserinfoPassword('https://host/p?to=a:b@c')).toBeUndefined();
    expect(urlUserinfoPassword('https://host/p#a:b@c')).toBeUndefined();
  });

  it('non-authority strings carry no userinfo: file paths, :memory:, bare words', () => {
    for (const value of ['file:./data/objectstack.db', ':memory:', 'public', 'a:b@c']) {
      expect(urlUserinfoPassword(value), value).toBeUndefined();
    }
  });

  it('only a NON-EMPTY password is credential material — `user@` and `user:@` carry no secret', () => {
    expect(urlUserinfoPassword('postgres://u@h/db')).toBeUndefined();
    expect(urlUserinfoPassword('postgres://u:@h/db')).toBeUndefined();
    expect(urlUserinfoPassword('postgres://:p@h/db')).toBe('p');
  });
});

describe('urlUserinfoUsername — the username half of the same grammar (#8876)', () => {
  it('judges the multi-host DSN forms `new URL()` rejects — the reason this helper exists (#8696)', () => {
    // `new URL('mongodb://app@h1:27017,h2:27017/app')` throws ERR_INVALID_URL
    // (measured in the filing); the accessor must judge it, not fail open.
    expect(urlUserinfoUsername('mongodb://app@h1:27017,h2:27017/app')).toBe('app');
    expect(urlUserinfoUsername('postgresql://u:p@h1:5432,h2:5432/db')).toBe('u');
  });

  it('a `user:pass@` URL is refused at publish but PARSED correctly here — stored legacy rows carry it', () => {
    // The publish door (`credentialFreeUrl`) refuses this shape; the accessor
    // still reads it, because #8155's URL-bearing legacy rows are exactly the
    // inputs the migration path must judge.
    expect(urlUserinfoPassword('mongodb://app:hunter2@h/db')).toBe('hunter2');
    expect(urlUserinfoUsername('mongodb://app:hunter2@h/db')).toBe('app');
  });

  it('an EMPTY username inside present userinfo is `""`, distinct from the `undefined` of no userinfo', () => {
    expect(urlUserinfoUsername('mongodb://:p@h/db')).toBe('');
    expect(urlUserinfoUsername('mongodb://h:27017/db')).toBeUndefined();
    expect(urlUserinfoUsername('postgres://:@h/db')).toBe('');
  });

  it('a bare username and a trailing-colon username both answer the username', () => {
    expect(urlUserinfoUsername('postgres://svc@h/db')).toBe('svc');
    // `user:@host` — what the read-path redaction of a legacy row round-trips as.
    expect(urlUserinfoUsername('postgres://svc:@h/db')).toBe('svc');
  });

  it('returns the RAW component — percent-encoding preserved for the caller to decode at use', () => {
    expect(urlUserinfoUsername('mongodb://app%40corp:x@h/db')).toBe('app%40corp');
    expect(urlUserinfoUsername('mongodb://app%40corp@h/db')).toBe('app%40corp');
  });

  it('username ends at the FIRST `:`; userinfo ends at the LAST `@` — same boundaries as the password half', () => {
    // Malformed literal `@` in the password must not change how much of the
    // userinfo is judged, on either half.
    expect(urlUserinfoUsername('postgres://u:p@ss@host/db')).toBe('u');
    // A `:` inside the password does not move the username split.
    expect(urlUserinfoUsername('postgres://u:p:q@h/db')).toBe('u');
  });

  it('a colon or `@` in a path, query or fragment is never userinfo', () => {
    expect(urlUserinfoUsername('https://host/a:b@c')).toBeUndefined();
    expect(urlUserinfoUsername('https://host/p?to=a:b@c')).toBeUndefined();
    expect(urlUserinfoUsername('https://host/p#a:b@c')).toBeUndefined();
  });

  it('non-authority strings carry no userinfo: file paths, :memory:, bare words', () => {
    for (const value of ['file:./data/objectstack.db', ':memory:', 'public', 'a:b@c']) {
      expect(urlUserinfoUsername(value), value).toBeUndefined();
    }
  });

  it('scheme-relative URLs are judged too', () => {
    expect(urlUserinfoUsername('//u:p@h/db')).toBe('u');
    expect(urlUserinfoUsername('//h/db')).toBeUndefined();
  });
});

/**
 * The passthrough spelling of the same secret (#9040) — the FOURTH: #7990
 * refused the top-level key, #8082 the URL userinfo, #8337 the URL query
 * parameter, and `options.auth.password` was the next syntax over. Measured on
 * mongodb@7.5.0 (the client `@objectstack/driver-mongodb` spreads
 * `config.options` into): the block is transformed into `MongoCredentials`, so
 * the passthrough password authenticated for real while sitting cleartext in
 * `sys_metadata`.
 *
 * Envelope note (same as the #8082 pin above): the zod issue's `code` and its
 * pathed location are the whole envelope at this layer — every schema refusal
 * is wrapped uniformly by the publish door (metadata-protocol's
 * `422 INVALID_METADATA`, whose `issues[]` carry these codes verbatim).
 */
describe('mongo options passthrough — credential refusal (#9040)', () => {
  const VALID = { database: 'events', host: 'mongo.internal', username: 'svc' } as const;
  const refusalAt = (options: Record<string, unknown>) => {
    const result = MongoConfigSchema.safeParse({ ...VALID, options });
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path.join('.') === 'options.auth.password');
  };

  it('refuses a non-empty `auth.password`, naming the mechanisms — and the true precedence', () => {
    const issue = refusalAt({ auth: { username: 'app', password: 'hunter2' } });
    expect(issue, 'refusal must be pathed at `options.auth.password`').toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain('`options.auth.password`');
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
    // Unlike #8337's query form, the "wins over" reassurance is TRUE here and
    // load-bearing: #8696's pin measures the bound secret outranking a
    // passthrough `auth` block at connect.
    expect(issue!.message).toContain('wins over');
  });

  it('refuses a `${…}` placeholder password exactly like a real one — and both doors report', () => {
    // A placeholder is a non-empty string, so the credential refusal fires;
    // `placeholderFreeDeep` (#8336) judges the same value independently. The
    // two `superRefine`s compose without changing each other's semantics —
    // the PM-mechanism assumption this pin verifies.
    const result = MongoConfigSchema.safeParse({
      ...VALID,
      options: { auth: { username: 'app', password: '${DB_PASSWORD}' } },
    });
    expect(result.success).toBe(false);
    const at = result.error!.issues.filter((i) => i.path.join('.') === 'options.auth.password');
    expect(at.length).toBe(2);
    const texts = at.map((i) => i.message).join('\n');
    expect(texts).toContain('#9040');
    expect(texts).toContain('#8336');
  });

  it('re-paths the refusal under `config.options.auth.password` on the authored artefact', () => {
    const result = DatasourceSchema.safeParse({
      name: 'events',
      driver: 'mongodb',
      config: { database: 'events', options: { auth: { username: 'app', password: 'hunter2' } } },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find(
      (i) => i.path.join('.') === 'config.options.auth.password',
    );
    expect(issue, 'issue must be re-pathed under config.options.auth.password').toBeDefined();
    expect(issue!.message).toContain('external.credentialsRef');
  });

  it('`auth.username` alone is NOT credential material (#8876 asymmetry) — stays accepted', () => {
    // The schema's question is "is a secret being persisted?", and a username
    // is not one. (The client separately refuses a username-only `auth` block
    // at construction — `credentials must be an object with 'username' and
    // 'password' properties`, measured — a loud connect-time failure that is
    // the client's own contract to enforce, not this door's.)
    expect(refusalAt({ auth: { username: 'app' } })).toBeUndefined();
  });

  it('an EMPTY `auth.password` carries no secret — the passthrough twin of `user:@host` (#8082)', () => {
    expect(refusalAt({ auth: { username: 'app', password: '' } })).toBeUndefined();
  });

  it('a non-string `auth.password` is not a secret the client accepts — left to its loud validation', () => {
    // MongoCredentials validation refuses a non-string password at
    // construction (measured); refusing it here as credential material would
    // claim a secret where the client sees a type error.
    expect(refusalAt({ auth: { username: 'app', password: 42 } })).toBeUndefined();
  });

  it('accepts the legitimate passthrough byte-identically (pin) — replicaSet, tls, timeouts', () => {
    // The dispatch fence: the refusal must not break what the passthrough is
    // FOR. Includes the redacted round-trip shape (`auth` with only a
    // username) — what the #9040 read path serves for an affected legacy row,
    // and what the Studio edit form PUTs back on an untouched "Save".
    for (const options of [
      { replicaSet: 'rs0', tls: true, connectTimeoutMS: 5000, serverSelectionTimeoutMS: 3000 },
      { auth: { username: 'app' }, replicaSet: 'rs0' },
    ]) {
      const config = { ...VALID, options };
      const before = MongoConfigSchema.safeParse(config);
      expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
      expect(MongoConfigSchema.parse(config)).toEqual(before.data);
      expect(before.data!.options).toEqual(options);
    }
  });
});

/**
 * The contradictory pair "`external.credentialsRef` bound + a mongo
 * `config.url` naming no user" is refused at the datasource level (#9041) —
 * the "absence must be loud" half of the #8696 family. The binding is a silent
 * no-op at connect (`buildMongoAuth` injects only when the URL's userinfo
 * names a user, because `MongoClient` credentials need a username the URL must
 * supply and fabricating an empty one is a measured handshake failure), so the
 * config cannot work as written and the authoring door — the one place both
 * halves are visible at once — says so.
 *
 * Envelope note (same as the #8082/#9040 pins above): the zod issue's `code`
 * and its pathed location are the whole envelope at this layer — every schema
 * refusal is wrapped uniformly by the publish door (metadata-protocol's
 * `422 INVALID_METADATA`, whose `issues[]` carry these codes verbatim).
 */
describe('datasource — bound credentialsRef + user-less mongo url refused (#9041)', () => {
  const BOUND = { credentialsRef: 'sys_secret:01J9ZK4T2N' } as const;
  const parse = (ds: Record<string, unknown>) => DatasourceSchema.safeParse(ds);
  const refusalOf = (ds: Record<string, unknown>) => {
    const result = parse(ds);
    if (result.success) return undefined;
    return result.error.issues.find(
      (i) => i.path.join('.') === 'config.url' && i.message.includes('#9041'),
    );
  };

  it('refuses the pair, pathed at `config.url`, naming BOTH fixes and prescribing neither', () => {
    const issue = refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://db.internal:27017/app' },
      external: BOUND,
    });
    expect(issue, 'refusal must be pathed at `config.url`').toBeDefined();
    expect(issue!.code).toBe('custom');
    // Fence ③ — both valid authoring fixes are named, neither prescribed:
    // add the username to the URL, or drop the binding.
    expect(issue!.message).toContain('add the username');
    expect(issue!.message).toContain('mongodb://user@host/db');
    expect(issue!.message).toContain('remove the `external.credentialsRef` binding');
    // And the mechanism, so the author is told WHY the pair cannot work.
    expect(issue!.message).toContain('silent no-op');
  });

  it('judges a legacy `driver: mongo` row identically (alias-resolved, like the #9040 read path)', () => {
    const issue = refusalOf({
      name: 'events',
      driver: 'mongo',
      config: { url: 'mongodb://db.internal:27017/app' },
      external: BOUND,
    });
    expect(issue).toBeDefined();
  });

  it('a `mongodb+srv://` URL naming no user is the same silent no-op — refused', () => {
    const issue = refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb+srv://c0.example.net/app' },
      external: BOUND,
    });
    expect(issue).toBeDefined();
  });

  it('accepts the blessed shape byte-identically: bare-username URL + bound secret (#8155)', () => {
    const ds = {
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://app@db.internal:27017/app' },
      external: { ...BOUND },
    };
    const result = parse(ds);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data!.config).toEqual(ds.config);
    expect(result.data!.external!.credentialsRef).toBe(BOUND.credentialsRef);
    // Multi-host too — the form `new URL()` cannot even parse (#8696).
    const multi = parse({
      ...ds,
      config: { url: 'mongodb://app@h1:27017,h2:27017/app' },
    });
    expect(multi.success, JSON.stringify(multi.error?.issues)).toBe(true);
  });

  it('accepts a user-less URL with NO binding — anonymous connect is a legal intent', () => {
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://db.internal:27017/app' },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('fence ② — present-but-EMPTY userinfo is NOT this refusal (the client refuses those itself)', () => {
    // `urlUserinfoUsername` answers `''` (userinfo present), not `undefined`:
    // `MongoClient` throws `MongoParseError: URI contained empty userinfo
    // section` on these forms with or without a bound secret (measured on the
    // card), so the silent-no-op refusal deliberately does not claim them.
    for (const url of ['mongodb://@db.internal:27017/app', 'mongodb://:p@db.internal:27017/app']) {
      expect(urlUserinfoUsername(url)).toBe('');
      expect(refusalOf({
        name: 'events',
        driver: 'mongodb',
        config: { url },
        external: { ...BOUND },
      })).toBeUndefined();
    }
  });

  it('the COMPOSED branch is #9147\'s arm, never this one — a composed config reports neither #9041 nor a `config.url` path', () => {
    // With no `url` the discrete `username` is live and the factory
    // interpolates the bound secret into the URI it composes (#8696's other
    // branch), so a composed config that NAMES a user has no contradictory
    // pair at all …
    const named = parse({
      name: 'events',
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal', username: 'svc' },
      external: { ...BOUND },
    });
    expect(named.success, JSON.stringify(named.error?.issues)).toBe(true);
    // … and one that does not is judged by #9147's own message, with #9041's
    // URL prescription (which would name a fix this branch cannot take) kept
    // out. The two arms partition the input; they never both fire.
    const unnamed = parse({
      name: 'events',
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal' },
      external: { ...BOUND },
    });
    expect(unnamed.success).toBe(false);
    expect(unnamed.error!.issues.some((i) => i.message.includes('#9041'))).toBe(false);
    expect(unnamed.error!.issues.some((i) => i.path.join('.') === 'config.url')).toBe(false);
  });

  it('an empty-string `credentialsRef` is not a binding — mirrors the connect path\'s truthy check', () => {
    expect(refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://db.internal:27017/app' },
      external: { credentialsRef: '' },
    })).toBeUndefined();
  });

  it('fence ① — the postgres arm is NOT assumed: a user-less pg DSN + binding stays accepted', () => {
    // #8873 measured pg injecting on a user-less DSN (`pg` sends a password
    // only when the server asks), so the mongo mechanism does not transfer;
    // the postgres equivalent is re-judged after #8873, never inherited.
    const result = parse({
      name: 'warehouse',
      driver: 'postgres',
      config: { url: 'postgresql://db.internal:5432/analytics' },
      schemaMode: 'external',
      external: { ...BOUND },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('a non-string `url` is the config gate\'s finding, not this one', () => {
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: 42 },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    // The driver-config parse reports the type error at the same path; the
    // #9041 refusal stays silent rather than judging a value that has no
    // userinfo to read.
    expect(result.error!.issues.some((i) => i.message.includes('#9041'))).toBe(false);
  });

  it('composes with the #9040 passthrough refusal — one artefact, both findings, own paths', () => {
    // The PM-mechanism composition pin: the datasource-level #9041 refinement
    // and the config-level #9040 `credentialFreeMongoOptions` judge the same
    // artefact independently — an input violating both reports both.
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: {
        url: 'mongodb://db.internal:27017/app',
        options: { auth: { username: 'app', password: 'hunter2' } },
      },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('config.url');
    expect(paths).toContain('config.options.auth.password');
    expect(result.error!.issues.some((i) => i.message.includes('#9041'))).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9040'))).toBe(true);
  });

  it('an empty `config.url` is the COMPOSED branch, not this one — a live discrete username is not refused', () => {
    // The over-refusal #9147 corrected while redrawing this boundary. At
    // connect `buildMongoUrl` opens `if (explicit) return explicit;`, so an
    // empty `url` falls through and composes from the discrete fields — where
    // `username: 'svc'` makes the bound secret live. Judging it as a "url
    // naming no user" rejected, at publish, a datasource that connects
    // authenticated. The arms split on truthiness, as the factory does.
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: '', database: 'events', host: 'mongo.internal', username: 'svc' },
      external: { ...BOUND },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('composes with the #8082 userinfo refusal the other way: a password-bearing URL has a USER', () => {
    // `user:password@host` violates #8082, but its userinfo NAMES a user — so
    // this refusal correctly stays out and the author gets exactly the #8082
    // prescription (bind the secret), not a contradictory second message.
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://app:hunter2@db.internal:27017/app' },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('#8082'))).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9041'))).toBe(false);
  });
});

/**
 * The COMPOSED-branch twin of the pair above (#9147) — `external.credentialsRef`
 * bound while the mongo `config` authors no `url` and names no `username`.
 *
 * Same silent discard, one branch over, and the branches were measured to agree
 * on this input before either was refused — so this inherits #9041's ruling
 * rather than re-opening it. What does NOT carry over is the remedy: with no
 * `url` the discrete `config.username` is the live field, so the fix is
 * `config.username`, and #9041's "add the username to the URL's userinfo" would
 * name a fix this branch cannot take.
 *
 * The mechanism, measured against `default-datasource-driver-factory.ts`: with
 * no `url`, `buildMongoUrl` composes the URI and the bound secret's only route
 * into it is the userinfo written beside a username (`const auth = user ? … :
 * ''`); `buildMongoAuth`, the DSN branch's route, returns early on `!url`. So a
 * falsy `username` leaves the secret with nowhere to go.
 *
 * Envelope note (same as the #8082/#9040/#9041 pins above): the zod issue's
 * `code` and its pathed location are the whole envelope at this layer — every
 * schema refusal is wrapped uniformly by the publish door (metadata-protocol's
 * `422 INVALID_METADATA`, whose `issues[]` carry these codes verbatim).
 */
describe('datasource — bound credentialsRef + composed mongo config naming no username refused (#9147)', () => {
  const BOUND = { credentialsRef: 'sys_secret:01J9ZK4T2N' } as const;
  /** The composed branch's minimum viable target — no `url`, so the URI is built. */
  const COMPOSED = { database: 'events', host: 'mongo.internal' } as const;
  const parse = (ds: Record<string, unknown>) => DatasourceSchema.safeParse(ds);
  const refusalOf = (ds: Record<string, unknown>) => {
    const result = parse(ds);
    if (result.success) return undefined;
    return result.error.issues.find(
      (i) => i.path.join('.') === 'config.username' && i.message.includes('#9147'),
    );
  };

  // ── the newly-refused conjunction ─────────────────────────────────────────

  it('refuses the pair, pathed at `config.username`, naming BOTH fixes and prescribing neither', () => {
    const issue = refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED },
      external: { ...BOUND },
    });
    expect(issue, 'refusal must be pathed at `config.username`').toBeDefined();
    expect(issue!.code).toBe('custom');
    // Both valid authoring fixes named, neither prescribed.
    expect(issue!.message).toContain('add `username` to `config`');
    expect(issue!.message).toContain('remove the `external.credentialsRef` binding');
    // And the mechanism, so the author is told WHY the pair cannot work.
    expect(issue!.message).toContain('silent no-op');
    // The remedy that does NOT apply here must not be copied in: on this branch
    // there is no URL to put a userinfo in, and a refusal naming an
    // inapplicable fix is worse than no refusal (the pre-#4410
    // `belongsInConfig` defect, documented in datasource.zod.ts).
    expect(issue!.message).not.toContain('mongodb://user@host/db');
    expect(issue!.message).not.toContain('add the username to the URL');
  });

  it('judges a legacy `driver: mongo` row identically (alias-resolved, like #9041 and the #9040 read path)', () => {
    expect(refusalOf({
      name: 'events',
      driver: 'mongo',
      config: { ...COMPOSED },
      external: { ...BOUND },
    })).toBeDefined();
  });

  it('an EMPTY-STRING `username` is refused too — it is the same silent no-op, and the prescription must land somewhere enforced', () => {
    // Deliberate asymmetry with #9041's present-but-empty carve-out: there
    // `MongoClient` throws on the empty userinfo forms, so the shape is
    // already loud. Here nothing throws — `username: ''` is falsy at
    // `buildMongoUrl`'s `user ?` test, composes the same userinfo-free URI and
    // connects anonymously. Accepting it would leave this refusal prescribing
    // `config.username` while the platform still accepted the one spelling of
    // `config.username` that keeps the binding silent.
    expect(refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED, username: '' },
      external: { ...BOUND },
    })).toBeDefined();
  });

  it('an empty `config.url` routes HERE, not to #9041 — the arms split on the factory\'s own branch test', () => {
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: '', ...COMPOSED },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('#9147'))).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9041'))).toBe(false);
  });

  // ── the fence: each single condition absent is still ACCEPTED ─────────────

  it('near-miss ① `url` present (naming a user) — the discrete `username` is superseded, nothing to refuse', () => {
    const ds = {
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://app@db.internal:27017/app' },
      external: { ...BOUND },
    };
    const result = parse(ds);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    // Byte-identical across parses — this refusal changed nothing on this path.
    expect(DatasourceSchema.parse(ds)).toEqual(result.data);
  });

  it('near-miss ① `url` present naming NO user — exactly ONE refusal fires, and it is #9041\'s', () => {
    // The arms partition the input: the author must never receive two messages
    // prescribing different fixes for one datasource.
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { url: 'mongodb://db.internal:27017/app' },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('#9041'))).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9147'))).toBe(false);
  });

  it('near-miss ② a discrete `username` present — the branch where the bound secret is LIVE (#8696)', () => {
    const ds = {
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED, username: 'svc' },
      external: { ...BOUND },
    };
    const result = parse(ds);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data!.config).toEqual(ds.config);
    expect(DatasourceSchema.parse(ds)).toEqual(result.data);
  });

  it('near-miss ③ no binding — a composed anonymous datasource is a legal intent', () => {
    const ds = { name: 'events', driver: 'mongodb', config: { ...COMPOSED } };
    const result = parse(ds);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(DatasourceSchema.parse(ds)).toEqual(result.data);
  });

  it('near-miss ③ an empty-string `credentialsRef` is not a binding — mirrors the connect path\'s truthy check', () => {
    // `DatasourceConnectionService` resolves the ref under `if (credentialsRef)`,
    // so an empty ref binds nothing there and is not a binding here either.
    expect(refusalOf({
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED },
      external: { credentialsRef: '' },
    })).toBeUndefined();
  });

  it('fence — the postgres arm is NOT widened to: a composed pg config with no username + binding stays accepted', () => {
    // #8873 measured `pg` receiving the bound password regardless of the DSN
    // naming a user, so the mongo mechanism does not transfer to it on this
    // branch any more than it did on the URL branch.
    const result = parse({
      name: 'warehouse',
      driver: 'postgres',
      schemaMode: 'external',
      config: { database: 'analytics', host: 'wh.internal' },
      external: { ...BOUND, allowWrites: false },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('a non-string `username` is the config gate\'s finding, not this one', () => {
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED, username: 42 },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    // The driver-config parse reports the type error at the same path; this
    // refusal stays silent rather than judging a value with no branch to predict.
    expect(result.error!.issues.some((i) => i.path.join('.') === 'config.username')).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9147'))).toBe(false);
  });

  it('composes with the #9040 passthrough refusal — one artefact, both findings, own paths', () => {
    const result = parse({
      name: 'events',
      driver: 'mongodb',
      config: { ...COMPOSED, options: { auth: { username: 'app', password: 'hunter2' } } },
      external: { ...BOUND },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('config.username');
    expect(paths).toContain('config.options.auth.password');
    expect(result.error!.issues.some((i) => i.message.includes('#9147'))).toBe(true);
    expect(result.error!.issues.some((i) => i.message.includes('#9040'))).toBe(true);
  });
});
