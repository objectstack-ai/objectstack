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

import {
  BUILTIN_DRIVER_IDS,
  CREDENTIAL_URL_QUERY_PARAM_NAMES,
  getDriverConfigSchema,
  urlCredentialQueryParams,
  urlUserinfoPassword,
  urlUserinfoUsername,
} from './driver/index';
import {
  redactDatasourceConfig,
  redactUrlCredentialQueryParams,
  redactUrlCredentials,
  redactUrlPassword,
  redactableConfigKeys,
  refusedCredentialKeys,
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
