// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectDatabaseUrl } from '@objectstack/runtime';
import type { DotenvReading } from '../commands/doctor.js';
import {
  envRungVariable,
  resolveDatabaseSource,
  type ProjectEnvLoad,
} from './schema-migrate.js';

/**
 * [#22581] Who named the database `os migrate plan` / `apply` report.
 *
 * The end-to-end pins (`commands/migrate/plan.reads-env-files.integration.test.ts`)
 * drive the commands; this file pins the two pieces of the naming that a
 * fixture cannot reach cheaply: which variable the env rung read, held equal to
 * `resolveProjectDatabaseUrl` itself, and every rung's name.
 */

const VARIABLES = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL'] as const;
const VALUES = [undefined, '', '   ', 'file:named.db'] as const;

describe('envRungVariable — the variable the env rung of resolveProjectDatabaseUrl read', () => {
  it('names, over every combination of the three variables, the one whose value alone gives the same answer', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'os-22581-rung-'));
    let envAnswers = 0;
    for (const a of VALUES) for (const b of VALUES) for (const c of VALUES) {
      const env: Record<string, string | undefined> = {};
      const values = [a, b, c];
      VARIABLES.forEach((name, i) => {
        if (values[i] !== undefined) env[name] = values[i] === 'file:named.db' ? `file:${name}.db` : values[i];
      });
      const full = resolveProjectDatabaseUrl({ env, projectRoot });
      if (full.source !== 'env') continue;
      envAnswers += 1;
      const variable = envRungVariable(env);
      const alone = resolveProjectDatabaseUrl({ env: { [variable]: env[variable] }, projectRoot });
      expect({ env, variable, alone }).toEqual({ env, variable, alone: full });
    }
    // The loop must have judged something: of the 64 combinations, the 31
    // with a non-blank `OS_DATABASE_URL ?? DATABASE_URL` or `TURSO_DATABASE_URL`.
    expect(envAnswers).toBe(31);
  });
});

function load(opts: { shell?: Record<string, string>; files?: Record<string, string> }): ProjectEnvLoad {
  const reading: DotenvReading = {
    nodeEnv: 'production',
    cwd: '/project',
    files: ['/project/.env'],
    fileValues: new Map(Object.entries(opts.files ?? {})),
    fileOrigin: new Map(Object.keys(opts.files ?? {}).map((name) => [name, '/project/.env'])),
  };
  return { reading, shellEnv: { ...(opts.shell ?? {}) } };
}

/** Run `fn` with `OS_DATABASE_URL` set to `value` in this process, then put it back. */
function withDatabaseUrl(value: string | undefined, fn: () => void): void {
  const saved = process.env.OS_DATABASE_URL;
  if (value === undefined) delete process.env.OS_DATABASE_URL;
  else process.env.OS_DATABASE_URL = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.OS_DATABASE_URL;
    else process.env.OS_DATABASE_URL = saved;
  }
}

describe('resolveDatabaseSource — one name per rung', () => {
  it('explicit: the flag, unless it is OS_DATABASE_URL, which oclif binds to the flag', () => {
    withDatabaseUrl(undefined, () => {
      expect(resolveDatabaseSource(load({}), { source: 'explicit' }, 'file:typed.db')).toEqual({ kind: 'flag' });
    });
    withDatabaseUrl('file:shell.db', () => {
      expect(resolveDatabaseSource(load({ shell: { OS_DATABASE_URL: 'file:shell.db' } }), { source: 'explicit' }, 'file:shell.db'))
        .toEqual({ kind: 'process-env', variable: 'OS_DATABASE_URL' });
      // Typed, and different from the exported value it overrides.
      expect(resolveDatabaseSource(load({ shell: { OS_DATABASE_URL: 'file:shell.db' } }), { source: 'explicit' }, 'file:typed.db'))
        .toEqual({ kind: 'flag' });
    });
    // A command parsed after an earlier load in the same process binds the `.env` value.
    withDatabaseUrl('file:dotenv.db', () => {
      expect(resolveDatabaseSource(load({ files: { OS_DATABASE_URL: 'file:dotenv.db' } }), { source: 'explicit' }, 'file:dotenv.db'))
        .toEqual({ kind: 'env-file', variable: 'OS_DATABASE_URL', file: '.env' });
    });
  });

  it('env: the file that supplied the variable, or the process environment', () => {
    withDatabaseUrl('file:x.db', () => {
      expect(resolveDatabaseSource(load({ files: { OS_DATABASE_URL: 'file:x.db' } }), { source: 'env' }, undefined))
        .toEqual({ kind: 'env-file', variable: 'OS_DATABASE_URL', file: '.env' });
      // Exported and in `.env`: the export wins, as dotenv-flow loads it.
      expect(resolveDatabaseSource(
        load({ shell: { OS_DATABASE_URL: 'file:x.db' }, files: { OS_DATABASE_URL: 'file:other.db' } }),
        { source: 'env' },
        undefined,
      )).toEqual({ kind: 'process-env', variable: 'OS_DATABASE_URL' });
    });
  });

  it('the config datasource and the default', () => {
    expect(resolveDatabaseSource(load({}), { source: 'config-datasource', datasourceName: 'main' }, undefined))
      .toEqual({ kind: 'config-datasource', datasource: 'main' });
    expect(resolveDatabaseSource(load({}), { source: 'unified-default' }, undefined)).toEqual({ kind: 'default' });
    expect(resolveDatabaseSource(load({}), { source: 'legacy-file' }, undefined)).toEqual({ kind: 'default' });
  });
});
