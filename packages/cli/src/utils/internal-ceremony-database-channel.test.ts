// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31488 — which database `os start`'s ownership refusal must name, and the
 * channel that carries it to the `serve` child.
 *
 * The ceremony (`os migrate organization-ownership`) resolves its database the
 * way every CLI command does: `--database-url`, then `$OS_DATABASE_URL`, then
 * the project's declared datasource, then `<state dir>/data/objectstack.db`,
 * where the state dir is `$OS_HOME` or the project's `.objectstack`. `os start`
 * resolves the same ladder with two inputs the ceremony never sees: its
 * `-d` flag and its `--home` flag. A database reached through either is one
 * the ceremony, run bare in the same shell, does not find.
 *
 *  - ⭐ `-d` → named; `--home` with the home's file → named;
 *  - `--home` beside `$OS_DATABASE_URL` or a declared datasource → not named
 *    (the ceremony reads those too); no flag → not named (the default and an
 *    exported `$OS_HOME` reach the same file);
 *  - the channel is owned by the parent: set when named, deleted otherwise.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV,
  INTERNAL_CEREMONY_DATABASE_DRIVER_ENV,
  INTERNAL_CEREMONY_DATABASE_URL_ENV,
  ceremonyDatabaseUrl,
  readCeremonyConnectionChannel,
  readCeremonyDatabaseChannel,
  writeCeremonyConnectionChannel,
  writeCeremonyDatabaseChannel,
} from './internal-ceremony-database-channel.js';

const HOME_FILE = 'file:/srv/os/home/data/objectstack.db';

describe('ceremonyDatabaseUrl — the database the refusal names, or none', () => {
  it('⭐ a database from `-d` is named, whatever the home', () => {
    expect(ceremonyDatabaseUrl({ url: 'file:A.db', source: 'explicit' }, { homeFlag: undefined })).toBe('file:A.db');
    expect(ceremonyDatabaseUrl({ url: 'file:A.db', source: 'explicit' }, { homeFlag: '/srv/os/home' })).toBe('file:A.db');
  });

  it('⭐ the file of a `--home` home is named', () => {
    expect(ceremonyDatabaseUrl({ url: HOME_FILE, source: 'unified-default' }, { homeFlag: '/srv/os/home' })).toBe(HOME_FILE);
    expect(ceremonyDatabaseUrl({ url: 'file:/srv/os/home/data/dev.db', source: 'legacy-file' }, { homeFlag: '/srv/os/home' }))
      .toBe('file:/srv/os/home/data/dev.db');
  });

  it('a database the ceremony reaches by its own ladder is not named', () => {
    // `$OS_DATABASE_URL` / a declared datasource: the ceremony reads them too.
    expect(ceremonyDatabaseUrl({ url: 'postgres://db/os', source: 'env' }, { homeFlag: '/srv/os/home' })).toBeUndefined();
    expect(ceremonyDatabaseUrl({ url: 'file:/app/data.db', source: 'config-datasource' }, { homeFlag: '/srv/os/home' }))
      .toBeUndefined();
    // No flag: the project's `.objectstack`, or an exported `$OS_HOME`, is the ceremony's default too.
    expect(ceremonyDatabaseUrl({ url: HOME_FILE, source: 'unified-default' }, { homeFlag: undefined })).toBeUndefined();
  });
});

describe('the ceremony-database channel to the serve child', () => {
  it('is set when there is a database to name, and deleted otherwise — an inherited copy never speaks', () => {
    const env: NodeJS.ProcessEnv = {};
    writeCeremonyDatabaseChannel(env, 'file:A.db');
    expect(env[INTERNAL_CEREMONY_DATABASE_URL_ENV]).toBe('file:A.db');
    expect(readCeremonyDatabaseChannel(env)).toBe('file:A.db');
    writeCeremonyDatabaseChannel(env, undefined);
    expect(INTERNAL_CEREMONY_DATABASE_URL_ENV in env).toBe(false);
    expect(readCeremonyDatabaseChannel(env)).toBeUndefined();
    expect(readCeremonyDatabaseChannel({ [INTERNAL_CEREMONY_DATABASE_URL_ENV]: '' })).toBeUndefined();
  });
});

describe('#31547 — the driver and the token flag, carried beside the URL', () => {
  it('⭐ --database-driver is carried by value, --database-auth-token only as "the flag gave it": its value is never written', () => {
    const env: NodeJS.ProcessEnv = {};
    writeCeremonyConnectionChannel(env, { databaseDriver: 'turso', databaseAuthToken: 'tok-s3cret-31547' });
    expect(env[INTERNAL_CEREMONY_DATABASE_DRIVER_ENV]).toBe('turso');
    expect(env[INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV]).toBe('1');
    expect(JSON.stringify(env)).not.toContain('s3cret');
    // Shaped as the guard's options, so `serve` spreads it as it is.
    expect(readCeremonyConnectionChannel(env)).toEqual({ databaseDriver: 'turso', databaseAuthTokenFromFlag: true });
  });

  it('is owned by the parent: no flag, no variable — an inherited copy never speaks', () => {
    const env: NodeJS.ProcessEnv = {
      [INTERNAL_CEREMONY_DATABASE_DRIVER_ENV]: 'pg',
      [INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV]: '1',
    };
    writeCeremonyConnectionChannel(env, { databaseDriver: undefined, databaseAuthToken: undefined });
    expect(INTERNAL_CEREMONY_DATABASE_DRIVER_ENV in env).toBe(false);
    expect(INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV in env).toBe(false);
    expect(readCeremonyConnectionChannel(env)).toEqual({});
    // An empty flag value put nothing in the child's environment either (`start` / `dev` test truthiness).
    writeCeremonyConnectionChannel(env, { databaseDriver: '', databaseAuthToken: '' });
    expect(readCeremonyConnectionChannel(env)).toEqual({});
  });

  it('⭐ `os dev` writes both channels from its own resolution, as `os start` does: one hand-off, no second resolver', () => {
    for (const command of ['start', 'dev']) {
      const source = readFileSync(new URL(`../commands/${command}.ts`, import.meta.url), 'utf8');
      expect(source, command).toMatch(/writeCeremonyDatabaseChannel\(localEnv, ceremonyDatabaseUrl\(resolvedDb, \{ homeFlag: /);
      expect(source, command).toMatch(/writeCeremonyConnectionChannel\(localEnv, \{\s*databaseDriver: flags\['database-driver'\],\s*databaseAuthToken: flags\['database-auth-token'\],/);
    }
  });
});

