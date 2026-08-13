// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8081 — the services half of #7990: the datasource credential READ path.
 *
 * ## What each pin reads on `origin/main` (reverse verification)
 *
 * RED on main (carries the defect this card fixes):
 *  - "serves a stored row's cleartext password" — `getDatasource()` returned
 *    `config` verbatim, so `config.password: 'hunter2'` came back on
 *    `GET /api/v1/datasources/:name`. Measured on `origin/main` before the fix.
 *  - "serves the credential embedded in a connection URL" — the same read
 *    returned `postgresql://admin:hunter2@db.internal:5432/app`. This is the
 *    half a `config.password`-only scrub would have left open.
 *  - "an untouched Save does not destroy the stored credential" — red on main
 *    for a REASON WORTH RECORDING, and not the one it was written for. On main
 *    the edit form is served `config.password` verbatim, posts it straight
 *    back, and #8078's write gate refuses it — so editing any legacy row
 *    through the wizard answers 400 for a value the server itself supplied.
 *    Redacting the read is what makes that round-trip legal again; the restore
 *    is what stops it deleting the credential instead. Measured, not inferred.
 *  - "the SERVED config is redacted while the STORED record keeps its
 *    credential" — pins both halves at once, because the store-side half alone
 *    is green on main for the worst reason (nothing redacts there).
 *
 * GREEN on main (guards behaviour that must NOT change):
 *  - "#8078's parse refusal still fires, with its guidance intact" — guards the
 *    spec half. The refusal message names the secret binder and
 *    `external.credentialsRef`; this card must not weaken it while adding a
 *    read-path scrub next to it. Passes on main and must keep passing.
 *  - "a URL-embedded credential is still ACCEPTED at the write door" — guards
 *    the deliberately UNRULED boundary (#7990): #8078 pinned URL credentials as
 *    a fact rather than refusing them. Redacting on read must not drift into
 *    refusing on write. Passes on main and must keep passing.
 *  - "the connect path still sees the stored credential" — guards the fact that
 *    redaction is a read-path act only, so a legacy datasource keeps working.
 *    Passes on main trivially and would go red if the scrub ever mutated the
 *    stored record.
 */

import { describe, it, expect } from 'vitest';
import { validateDriverConfig, getDriverConfigSchema, BUILTIN_DRIVER_IDS } from '@objectstack/spec/data';
import {
  redactDatasourceConfig,
  restoreRedactedConfig,
  redactUrlPassword,
  refusedCredentialKeys,
  redactableConfigKeys,
} from '../datasource-config-redaction.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';

/** A legacy row: written before #8078, so it carries inline cleartext. */
const LEGACY_PG: StoredDatasource = {
  name: 'legacy_pg',
  driver: 'postgres',
  origin: 'runtime',
  config: {
    host: 'db.internal',
    database: 'app',
    username: 'admin',
    password: 'hunter2',
    url: 'postgresql://admin:hunter2@db.internal:5432/app',
  },
  external: { credentialsRef: 'sys_secret:abc' },
};

function makeService(seed: StoredDatasource[]) {
  const records: StoredDatasource[] = seed.map((r) => ({ ...r, config: { ...r.config } }));
  const cfg: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records,
    getDatasourceRecord: async (n) => records.find((r) => r.name === n),
    putDatasourceRecord: async (rec) => {
      const i = records.findIndex((r) => r.name === rec.name);
      if (i >= 0) records[i] = rec;
      else records.push(rec);
    },
    deleteDatasourceRecord: async () => {},
    writeSecret: async () => 'sys_secret:new',
    countBoundObjects: async () => 0,
  };
  return { records, service: new DatasourceAdminService(cfg) };
}

describe('the refusal set is DERIVED from the driver contracts, not retyped', () => {
  it('every `z.never()` config key is found by the derivation', () => {
    // The property that makes this module self-extending: #8078 spelled a
    // refused inline credential as `z.never()`, so the schema IS the list.
    expect(refusedCredentialKeys('postgres')).toEqual(['password']);
    expect(refusedCredentialKeys('mysql')).toEqual(['password']);
    expect(refusedCredentialKeys('mongodb')).toEqual(['password']);
    expect(refusedCredentialKeys('turso')).toEqual(['authToken']);
    // Credential-less drivers declare none, and must not acquire one by accident.
    expect(refusedCredentialKeys('sqlite')).toEqual([]);
    expect(refusedCredentialKeys('memory')).toEqual([]);
  });

  it('the unknown-driver fallback covers every spelling the contracts refuse', () => {
    // Guards the one hand-written list in the module: if a driver refuses a NEW
    // credential key, the fallback used for contract-less drivers must learn it
    // too, or an unknown driver's config would serve that spelling in cleartext.
    const declared = new Set<string>();
    for (const id of BUILTIN_DRIVER_IDS as readonly string[]) {
      for (const key of refusedCredentialKeys(id)) declared.add(key);
    }
    const fallback = new Set(redactableConfigKeys('a-driver-with-no-contract'));
    for (const key of declared) expect(fallback.has(key)).toBe(true);
  });

  it('a driver with no shipped contract still has its canonical credentials hidden', () => {
    expect(getDriverConfigSchema('not-a-real-driver' as never)).toBeUndefined();
    const { config, redactedKeys } = redactDatasourceConfig('not-a-real-driver', {
      host: 'h',
      password: 'hunter2',
      authToken: 'jwt',
    });
    expect(config).toEqual({ host: 'h' });
    expect(redactedKeys).toEqual(['authToken', 'password']);
  });
});

describe('read path: getDatasource() no longer serves a stored credential', () => {
  it('RED ON MAIN — a stored row\'s cleartext password does not reach the caller', async () => {
    const { service } = makeService([LEGACY_PG]);
    const ds = await service.getDatasource('legacy_pg');
    expect(ds).toBeDefined();
    expect(ds!.config).not.toHaveProperty('password');
    expect(JSON.stringify(ds!.config)).not.toContain('hunter2');
    // The non-credential half is untouched — this is a redaction, not a purge.
    expect(ds!.config).toMatchObject({ host: 'db.internal', database: 'app', username: 'admin' });
  });

  it('RED ON MAIN — the credential embedded in `config.url` does not reach the caller either', async () => {
    const { service } = makeService([LEGACY_PG]);
    const ds = await service.getDatasource('legacy_pg');
    // The scrub that stops at `config.password` is the one that only looks
    // finished: on main this same read served the password twice over.
    expect(ds!.config!.url).toBe('postgresql://admin@db.internal:5432/app');
    expect(ds!.redactedConfigKeys).toEqual(['password', 'url']);
  });

  it('names what it withheld, so a caller is not left inferring it from an absence', async () => {
    const { service } = makeService([
      { name: 'clean', driver: 'postgres', origin: 'runtime', config: { host: 'h', database: 'd' } },
    ]);
    const ds = await service.getDatasource('clean');
    expect(ds!.redactedConfigKeys).toEqual([]);
    expect(ds!.config).toEqual({ host: 'h', database: 'd' });
  });

  it('turso: the still-writable `encryptionKey` is redacted on read as well', async () => {
    const { service } = makeService([{
      name: 'turso_ds', driver: 'turso', origin: 'runtime',
      config: { url: 'libsql://db.turso.io', authToken: 'jwt-token', encryptionKey: 'aes-256-key' },
    }]);
    const ds = await service.getDatasource('turso_ds');
    expect(ds!.config).toEqual({ url: 'libsql://db.turso.io' });
    expect(ds!.redactedConfigKeys).toEqual(['authToken', 'encryptionKey']);
  });

  it('pre-#8078 ALIAS spellings are redacted — a stored row never met the parse that renamed them', async () => {
    const { service } = makeService([{
      name: 'ancient', driver: 'postgres', origin: 'runtime',
      config: { host: 'h', database: 'd', passwd: 'hunter2', pwd: 'hunter2' },
    }]);
    const ds = await service.getDatasource('ancient');
    expect(ds!.config).toEqual({ host: 'h', database: 'd' });
    expect(ds!.redactedConfigKeys).toEqual(['passwd', 'pwd']);
  });

  it('RED ON MAIN — the SERVED config is redacted while the STORED record keeps its credential', async () => {
    const { service, records } = makeService([LEGACY_PG]);
    const ds = await service.getDatasource('legacy_pg');

    // Both halves in one pin, deliberately. Asserting only that the store is
    // untouched passes on `origin/main` for the worst possible reason — nothing
    // redacts there, so served and stored are the same object's contents and
    // the pin is green while the defect is live. Pairing it with the served
    // side makes the pin fail on main and pass here, which is the only version
    // of it that pins anything (#7801).
    expect(ds!.config).not.toHaveProperty('password');
    // The connect path reads the raw record (`getDatasourceRecord`), not this
    // projection. If redaction ever mutated in place, a legacy datasource would
    // stop authenticating the moment someone opened its edit form.
    expect(records[0].config).toMatchObject({
      password: 'hunter2',
      url: 'postgresql://admin:hunter2@db.internal:5432/app',
    });
  });
});

describe('URL redaction is surgical', () => {
  it('removes only the password component of userinfo', () => {
    expect(redactUrlPassword('postgresql://admin:hunter2@db:5432/app'))
      .toBe('postgresql://admin@db:5432/app');
    expect(redactUrlPassword('mongodb://u:p@a.example.com:27017/db?replicaSet=rs0'))
      .toBe('mongodb://u@a.example.com:27017/db?replicaSet=rs0');
  });

  it('leaves a URL with no embedded password exactly as it was', () => {
    for (const url of [
      'postgresql://admin@db:5432/app',
      'postgresql://db:5432/app',
      'libsql://my-db.turso.io',
      'file:./data/objectstack.db',
      ':memory:',
    ]) {
      expect(redactUrlPassword(url)).toBe(url);
    }
  });

  it('a malformed password containing `@` is redacted WHOLE, not split at the first one', () => {
    // The userinfo boundary is the LAST `@` before the path. Matching the first
    // would leave `ss@host` behind — a redaction that publishes part of the
    // password while looking like it worked.
    expect(redactUrlPassword('postgres://u:p@ss@host/db')).toBe('postgres://u@host/db');
    expect(redactUrlPassword('postgres://u:p@ss@host/db')).not.toContain('ss');
  });

  it('does not mistake a colon in a path or query for userinfo', () => {
    // `@` and `:` after the first `/` are not userinfo, and a value that is not
    // a URL at all must survive byte-for-byte.
    expect(redactUrlPassword('https://host/a:b@c')).toBe('https://host/a:b@c');
    expect(redactUrlPassword('https://host/p?to=a:b@c')).toBe('https://host/p?to=a:b@c');
    expect(redactUrlPassword('public')).toBe('public');
    expect(redactUrlPassword('a:b@c')).toBe('a:b@c');
  });
});

describe('write path: the scrub must not turn "Save" into credential deletion', () => {
  it('RED WITHOUT THE RESTORE — an untouched round-trip keeps the stored credential', async () => {
    const { service, records } = makeService([LEGACY_PG]);
    // Exactly what the edit form does: GET, then PATCH the config it was given.
    const read = await service.getDatasource('legacy_pg');
    await service.updateDatasource('legacy_pg', { config: read!.config, label: 'Renamed' });

    expect(records[0].label).toBe('Renamed');
    expect(records[0].config).toMatchObject({
      password: 'hunter2',
      url: 'postgresql://admin:hunter2@db.internal:5432/app',
    });
  });

  it('an author who edits a NON-credential field still gets that edit', async () => {
    const { service, records } = makeService([LEGACY_PG]);
    const read = await service.getDatasource('legacy_pg');
    await service.updateDatasource('legacy_pg', {
      config: { ...read!.config, database: 'app_v2' },
    });
    expect(records[0].config).toMatchObject({ database: 'app_v2', password: 'hunter2' });
  });

  it('an author who rewrites the URL by hand WINS — the restore never overrides an edit', async () => {
    const { service, records } = makeService([LEGACY_PG]);
    await service.updateDatasource('legacy_pg', {
      config: { host: 'db.internal', database: 'app', username: 'admin', url: 'postgresql://admin@elsewhere:5432/app' },
    });
    // Not the stored URL: the patch differs from the redaction of it, so it is
    // an edit, not a round-trip.
    expect(records[0].config!.url).toBe('postgresql://admin@elsewhere:5432/app');
  });

  it('changing the DRIVER does not carry the old driver\'s credential across', async () => {
    const { service, records } = makeService([LEGACY_PG]);
    const read = await service.getDatasource('legacy_pg');
    await service.updateDatasource('legacy_pg', {
      driver: 'mysql',
      config: { host: 'db.internal', database: 'app', username: 'admin' },
    });
    expect(read!.config).not.toHaveProperty('password');
    expect(records[0].driver).toBe('mysql');
    expect(records[0].config).not.toHaveProperty('password');
  });

  it('restoreRedactedConfig is a no-op when there is nothing stored to restore', () => {
    expect(restoreRedactedConfig('postgres', { host: 'h' }, undefined)).toEqual({ host: 'h' });
    expect(restoreRedactedConfig('postgres', { host: 'h' }, { host: 'h' })).toEqual({ host: 'h' });
  });
});

describe('GREEN ON MAIN — #8078 is not weakened by anything above', () => {
  it('the parse refusal still fires, and its guidance still reaches the caller', async () => {
    const { service } = makeService([]);
    await expect(
      service.createDatasource({
        name: 'nope', driver: 'postgres',
        config: { host: 'h', database: 'd', password: 'hunter2' },
      } as never),
    ).rejects.toThrow(/is a credential and is not accepted inline/);

    // The guidance names BOTH mechanisms the refusal diverts to. A refusal that
    // said only "not allowed" would leave the author with no next move.
    const issues = validateDriverConfig('postgres', { host: 'h', password: 'x' });
    expect(issues).toMatchObject({ known: true });
    const message = (issues as { issues: Array<{ message: string }> }).issues[0].message;
    expect(message).toContain('external.credentialsRef');
    expect(message).toContain('secret binder');
  });

  it('an author who types a refused key into a PATCH is still refused', async () => {
    const { service } = makeService([LEGACY_PG]);
    await expect(
      service.updateDatasource('legacy_pg', {
        config: { host: 'h', database: 'd', password: 'newpassword' },
      } as never),
    ).rejects.toThrow(/is a credential and is not accepted inline/);
  });

  it('a URL-embedded credential is now REFUSED at the write door (#8082 — the ruling this pin waited for)', () => {
    // This pin used to assert the ACCEPTANCE, with the comment "this pin fails
    // the moment that boundary moves without a ruling". The ruling arrived
    // (#8082, maintainer 2026-08-12, Option A): the write door refuses a URL
    // userinfo password, so the pin inverts. The REDACTED shape the read path
    // serves (`u@h`) must stay accepted, or every untouched "Save" on a legacy
    // row would 400 — the #8126 regression shape, re-checked here from the
    // write side.
    const refused = validateDriverConfig('postgres', { url: 'postgresql://u:pass@h:5432/d' });
    expect(refused).toMatchObject({ known: true });
    const issues = (refused as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path).toEqual(['url']);
    expect(issues[0].message).toContain('external.credentialsRef');
    expect(validateDriverConfig('postgres', { url: 'postgresql://u@h:5432/d' }))
      .toEqual({ known: true, issues: [] });
  });
});
