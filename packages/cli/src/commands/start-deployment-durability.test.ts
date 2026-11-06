// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30120 (ruling A3) — the pieces `os start` decides the image refusal and the
 * boot block with. The real boots, refusal and block included, are pinned end
 * to end in `test/start-deployment-durability.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  DURABILITY_CHECK_ENV,
  INTERNAL_DEPLOYMENT_FINDINGS_ENV,
  formatDurabilityBootBlock,
  formatDurabilityRefusal,
  isDefaultedDatabase,
  missingDurableVariables,
  readDurabilityCheckSignal,
  sqliteFileOf,
  writeDeploymentFindingsChannel,
} from './start.js';

describe('the image switch', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['  ', 'off'],
    ['false', 'off'],
    ['0', 'off'],
    ['true', 'on'],
    ['TRUE', 'on'],
    [' 1 ', 'on'],
    ['yes', 'invalid'],
    ['enabled', 'invalid'],
  ])('%j reads %s', (raw, verdict) => {
    expect(readDurabilityCheckSignal({ [DURABILITY_CHECK_ENV]: raw })).toBe(verdict);
  });

  it('is not NODE_ENV: os start sets production on every boot, so production alone never refuses', () => {
    expect(readDurabilityCheckSignal({ NODE_ENV: 'production' })).toBe('off');
  });
});

describe('which variables the image requires and this boot did not get', () => {
  it('a database nobody chose is missing; one from the flag, the environment or the project config is not', () => {
    expect(isDefaultedDatabase('unified-default')).toBe(true);
    expect(isDefaultedDatabase('legacy-file')).toBe(true);
    for (const source of ['explicit', 'env', 'config-datasource'] as const) {
      expect(isDefaultedDatabase(source)).toBe(false);
    }
  });

  it('names each one missing, in the order the refusal lists them', () => {
    expect(missingDurableVariables({ databaseSource: 'unified-default', authSecretSet: false, secretKeySet: false })).toEqual([
      'OS_DATABASE_URL',
      'OS_AUTH_SECRET',
      'OS_SECRET_KEY',
    ]);
    expect(missingDurableVariables({ databaseSource: 'env', authSecretSet: true, secretKeySet: false })).toEqual(['OS_SECRET_KEY']);
    expect(missingDurableVariables({ databaseSource: 'env', authSecretSet: true, secretKeySet: true })).toEqual([]);
  });

  it('reads the file of a file: URL, and nothing of any other', () => {
    expect(sqliteFileOf('file:/data/app.db')).toBe('/data/app.db');
    expect(sqliteFileOf('file:///data/app.db')).toBe('/data/app.db');
    expect(sqliteFileOf('file:')).toBeUndefined();
    expect(sqliteFileOf('postgres://u:p@h:5432/db')).toBeUndefined();
  });
});

describe('the refusal', () => {
  const where = {
    authSecretFile: '/home/node/.objectstack/auth-secret',
    dataKeyFile: '/home/node/.objectstack/dev-crypto-key',
    defaultDatabaseFile: '/home/node/.objectstack/data/objectstack.db',
    exists: (f: string) => f.endsWith('auth-secret'),
  };

  it('names exactly the missing variables, and says how to set each', () => {
    const all = formatDurabilityRefusal(['OS_DATABASE_URL', 'OS_AUTH_SECRET', 'OS_SECRET_KEY'], where);
    expect(all).toContain('OS_DATABASE_URL, OS_AUTH_SECRET and OS_SECRET_KEY are not set');
    expect(all).toMatch(/^ {4}OS_DATABASE_URL {2}your database/m);
    expect(all).toContain('file:/path/on/a/mounted/volume/app.db');
    expect(all).toMatch(/^ {4}OS_AUTH_SECRET {3}a long random value/m);
    expect(all).toMatch(/^ {4}OS_SECRET_KEY {4}32 random bytes/m);

    const one = formatDurabilityRefusal(['OS_SECRET_KEY'], where);
    expect(one).toContain(': OS_SECRET_KEY is not set');
    expect(one).not.toContain('OS_DATABASE_URL');
    expect(one).not.toContain('OS_AUTH_SECRET');
  });

  it('says how a deployment on generated values carries them over, marking what this container holds', () => {
    const text = formatDurabilityRefusal(['OS_DATABASE_URL', 'OS_AUTH_SECRET', 'OS_SECRET_KEY'], where);
    expect(text).toContain('Carry them over before you set new ones');
    expect(text).toContain('docker exec <container> cat <file>');
    expect(text).toContain('OS_AUTH_SECRET   the contents of /home/node/.objectstack/auth-secret (present in this container)');
    expect(text).toContain('OS_SECRET_KEY    the contents of /home/node/.objectstack/dev-crypto-key\n');
    expect(text).toContain('file:/home/node/.objectstack/data/objectstack.db, if your data is that file on a kept volume');
  });
});

describe('the boot block', () => {
  it('lists each thing kept on this disk, with its file and the variable that moves it', () => {
    const block = formatDurabilityBootBlock({
      databaseFile: '/srv/.objectstack/data/objectstack.db',
      authSecretFile: '/srv/.objectstack/auth-secret',
      dataKeyFile: '/srv/.objectstack/dev-crypto-key',
    })!;
    expect(block).toContain('Production mode, and this server keeps these on its own disk');
    expect(block).toContain('Database: a SQLite file, /srv/.objectstack/data/objectstack.db (OS_DATABASE_URL is not set)');
    expect(block).toContain('Sign-in secret: generated and kept in /srv/.objectstack/auth-secret (OS_AUTH_SECRET is not set)');
    expect(block).toContain('kept in /srv/.objectstack/dev-crypto-key (OS_SECRET_KEY is not set)');
    expect(block).toContain('set OS_DATABASE_URL, OS_AUTH_SECRET and OS_SECRET_KEY');
    expect(block).toContain('Administrators see this notice in the Console too.');
  });

  it('a secret generated for this process only says so', () => {
    expect(formatDurabilityBootBlock({ authSecretFile: null })).toContain('generated for this process only');
  });

  it('a boot that keeps nothing on its disk by default prints nothing', () => {
    expect(formatDurabilityBootBlock({})).toBeUndefined();
  });
});

describe('the channel to the server process', () => {
  // The reader (`service-settings` `deployment-notice.ts`) spells the name in
  // its own module: the end-to-end pin reads the findings a real boot hands it.
  it('carries the findings as JSON, and is removed when there are none', () => {
    const env: Record<string, string | undefined> = { [INTERNAL_DEPLOYMENT_FINDINGS_ENV]: 'stale' };
    writeDeploymentFindingsChannel(env, { databaseFile: '/d.db', authSecretFile: null });
    expect(JSON.parse(env[INTERNAL_DEPLOYMENT_FINDINGS_ENV]!)).toEqual({ databaseFile: '/d.db', authSecretFile: null });
    writeDeploymentFindingsChannel(env, {});
    expect(INTERNAL_DEPLOYMENT_FINDINGS_ENV in env).toBe(false);
    env[INTERNAL_DEPLOYMENT_FINDINGS_ENV] = 'inherited';
    writeDeploymentFindingsChannel(env, undefined);
    expect(INTERNAL_DEPLOYMENT_FINDINGS_ENV in env).toBe(false);
  });
});
