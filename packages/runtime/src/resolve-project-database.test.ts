// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE default-database resolution (#6469).
 *
 * Before it existed, `os dev` / `os start` / `os migrate` resolved THREE
 * different default files in the same directory (`dev.db` / `objectstack.db` /
 * `standalone.db`) and none consulted the project config — `os migrate plan`
 * then reported 22 tables of drift against a freshly-created empty database of
 * its own making. These cases pin every rung of the maintainer-ruled priority
 * ladder; the cross-command agreement itself is pinned in
 * `packages/cli/src/commands/unified-db-resolution.pin.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  resolveProjectDatabaseUrl,
  normalizeDatabaseUrl,
  UNIFIED_DEFAULT_DB_FILENAME,
  LEGACY_DEFAULT_DB_FILENAMES,
} from './resolve-project-database.js';
import { resolveStandaloneDatabase } from './standalone-stack.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'os-6469-resolve-'));
});
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

const dataDir = () => join(root, '.objectstack', 'data');
const unified = () => join(dataDir(), UNIFIED_DEFAULT_DB_FILENAME);

function seedDataDir(...files: string[]): void {
  mkdirSync(dataDir(), { recursive: true });
  for (const f of files) writeFileSync(join(dataDir(), f), '');
}

describe('normalizeDatabaseUrl — sqlite:// is an alias of file: (#6469 ruling item 3)', () => {
  it('rewrites sqlite:// and sqlite: to file:', () => {
    expect(normalizeDatabaseUrl('sqlite:///abs/app.db')).toBe('file:/abs/app.db');
    expect(normalizeDatabaseUrl('sqlite://relative/app.db')).toBe('file:relative/app.db');
    expect(normalizeDatabaseUrl('sqlite:./app.db')).toBe('file:./app.db');
    expect(normalizeDatabaseUrl('SQLITE://x.db')).toBe('file:x.db');
    expect(normalizeDatabaseUrl('sqlite::memory:')).toBe('file::memory:');
  });

  it('leaves every other URL untouched (trimmed only)', () => {
    expect(normalizeDatabaseUrl('  postgres://u:p@h:5432/db ')).toBe('postgres://u:p@h:5432/db');
    expect(normalizeDatabaseUrl('file:/abs/app.db')).toBe('file:/abs/app.db');
    expect(normalizeDatabaseUrl('memory://x')).toBe('memory://x');
    expect(normalizeDatabaseUrl('libsql://db.turso.io')).toBe('libsql://db.turso.io');
  });
});

describe('resolveProjectDatabaseUrl — priority ladder', () => {
  it('explicit URL wins over everything, normalized', () => {
    seedDataDir('dev.db');
    const r = resolveProjectDatabaseUrl({
      explicitUrl: `sqlite://${join(root, 'x.db')}`,
      env: { OS_DATABASE_URL: 'postgres://elsewhere/db' },
      projectRoot: root,
    });
    expect(r).toEqual({ url: `file:${join(root, 'x.db')}`, source: 'explicit' });
  });

  it('OS_DATABASE_URL beats DATABASE_URL beats TURSO_DATABASE_URL', () => {
    expect(resolveProjectDatabaseUrl({
      env: { OS_DATABASE_URL: 'file:/a.db', DATABASE_URL: 'file:/b.db', TURSO_DATABASE_URL: 'libsql://x' },
      projectRoot: root,
    })).toEqual({ url: 'file:/a.db', source: 'env' });
    expect(resolveProjectDatabaseUrl({
      env: { DATABASE_URL: 'file:/b.db', TURSO_DATABASE_URL: 'libsql://x' },
      projectRoot: root,
    })).toEqual({ url: 'file:/b.db', source: 'env' });
    expect(resolveProjectDatabaseUrl({
      env: { TURSO_DATABASE_URL: 'libsql://x' },
      projectRoot: root,
    })).toEqual({ url: 'libsql://x', source: 'env' });
  });

  it('env URLs are normalized too (sqlite:// in OS_DATABASE_URL works)', () => {
    expect(resolveProjectDatabaseUrl({
      env: { OS_DATABASE_URL: 'sqlite:///abs/env.db' },
      projectRoot: root,
    })).toEqual({ url: 'file:/abs/env.db', source: 'env' });
  });

  it('blank env values are treated as unset (still the unified default)', () => {
    const r = resolveProjectDatabaseUrl({ env: { OS_DATABASE_URL: '  ' }, projectRoot: root });
    expect(r).toEqual({ url: `file:${unified()}`, source: 'unified-default' });
  });

  it('an explicit memory driver (flag or env) imposes no file default', () => {
    expect(resolveProjectDatabaseUrl({ explicitDriver: 'memory', env: {}, projectRoot: root }))
      .toEqual({ url: 'memory://', source: 'memory-driver' });
    expect(resolveProjectDatabaseUrl({ env: { OS_DATABASE_DRIVER: 'memory' }, projectRoot: root }))
      .toEqual({ url: 'memory://', source: 'memory-driver' });
    // …but an env URL still wins over the driver shortcut (driver selects the
    // engine; it does not erase an explicitly-named database).
    expect(resolveProjectDatabaseUrl({
      env: { OS_DATABASE_DRIVER: 'memory', OS_DATABASE_URL: 'memory://named' },
      projectRoot: root,
    })).toEqual({ url: 'memory://named', source: 'env' });
  });

  it('fresh project: the unified default file, under <projectRoot>/.objectstack/data', () => {
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root });
    expect(r).toEqual({ url: `file:${unified()}`, source: 'unified-default' });
  });

  it('OS_HOME beats projectRoot for the state dir; explicit homeDir beats OS_HOME', () => {
    const osHome = join(root, 'oshome');
    const explicitHome = join(root, 'flag-home');
    expect(resolveProjectDatabaseUrl({ env: { OS_HOME: osHome }, projectRoot: root }).url)
      .toBe(`file:${join(osHome, 'data', UNIFIED_DEFAULT_DB_FILENAME)}`);
    expect(resolveProjectDatabaseUrl({ env: { OS_HOME: osHome }, projectRoot: root, homeDir: explicitHome }).url)
      .toBe(`file:${join(explicitHome, 'data', UNIFIED_DEFAULT_DB_FILENAME)}`);
  });

  it('no projectRoot and no OS_HOME → the user-home state dir', () => {
    const r = resolveProjectDatabaseUrl({ env: {} });
    expect(r.url).toBe(`file:${join(homedir(), '.objectstack', 'data', UNIFIED_DEFAULT_DB_FILENAME)}`);
  });
});

describe('resolveProjectDatabaseUrl — legacy compat-read (#6469 ruling item 2)', () => {
  it('probe order is objectstack.db → dev.db → standalone.db, identical constants', () => {
    // The order itself is contract: dev.db holds real dev data, while
    // standalone.db is most likely an empty artifact of the pre-#6469 fork.
    expect([...LEGACY_DEFAULT_DB_FILENAMES]).toEqual(['dev.db', 'standalone.db']);
  });

  it('unified file present → unified wins, no notice, even when legacies exist', () => {
    seedDataDir(UNIFIED_DEFAULT_DB_FILENAME, 'dev.db', 'standalone.db');
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root });
    expect(r).toEqual({ url: `file:${unified()}`, source: 'unified-default' });
  });

  it('legacy dev.db is read when the unified file does not exist — with one loud line', () => {
    seedDataDir('dev.db');
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root });
    expect(r.url).toBe(`file:${join(dataDir(), 'dev.db')}`);
    expect(r.source).toBe('legacy-file');
    // The notice must name BOTH files and the migration command — an existing
    // environment must never look like data loss, and the operator must learn
    // how to converge.
    expect(r.notice).toContain(join(dataDir(), 'dev.db'));
    expect(r.notice).toContain(unified());
    expect(r.notice).toContain('mv ');
  });

  it('legacy standalone.db is read when it is the only file', () => {
    seedDataDir('standalone.db');
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root });
    expect(r.url).toBe(`file:${join(dataDir(), 'standalone.db')}`);
    expect(r.source).toBe('legacy-file');
  });

  it('dev.db beats standalone.db when both exist (real dev data over the fork artifact)', () => {
    seedDataDir('dev.db', 'standalone.db');
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root });
    expect(r.url).toBe(`file:${join(dataDir(), 'dev.db')}`);
  });
});

describe('resolveProjectDatabaseUrl — config-declared default datasource', () => {
  function writeArtifact(bundle: unknown, envelope = false): string {
    const p = join(root, 'objectstack.json');
    writeFileSync(p, JSON.stringify(envelope ? { schemaVersion: 1, metadata: bundle } : bundle));
    return p;
  }

  const CRM_PRIMARY = {
    datasources: [
      { name: 'crm_primary', driver: 'sqlite', config: { filename: '.objectstack/data/crm.db' } },
    ],
    datasourceMapping: [{ default: true, datasource: 'crm_primary' }],
  };

  it('a { default: true } mapping rule resolves the declared sqlite datasource, relative to projectRoot', () => {
    const artifactPath = writeArtifact(CRM_PRIMARY);
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root, artifactPath });
    expect(r).toEqual({
      url: `file:${join(root, '.objectstack', 'data', 'crm.db')}`,
      source: 'config-datasource',
      datasourceName: 'crm_primary',
    });
  });

  it('unwraps the { schemaVersion, metadata } artifact envelope', () => {
    const artifactPath = writeArtifact(CRM_PRIMARY, true);
    const r = resolveProjectDatabaseUrl({ env: {}, projectRoot: root, artifactPath });
    expect(r.source).toBe('config-datasource');
    expect(r.url).toBe(`file:${join(root, '.objectstack', 'data', 'crm.db')}`);
  });

  it('a url-carrying driver resolves through config.url (spec alias table: pg → postgres)', () => {
    const artifactPath = writeArtifact({
      datasources: [{ name: 'warehouse', driver: 'pg', config: { url: 'postgres://u@h:5432/wh' } }],
      datasourceMapping: [{ default: true, datasource: 'warehouse' }],
    });
    expect(resolveProjectDatabaseUrl({ env: {}, projectRoot: root, artifactPath })).toEqual({
      url: 'postgres://u@h:5432/wh',
      source: 'config-datasource',
      datasourceName: 'warehouse',
    });
  });

  it('explicit URL and env still beat the config declaration', () => {
    const artifactPath = writeArtifact(CRM_PRIMARY);
    expect(resolveProjectDatabaseUrl({
      explicitUrl: 'file:/explicit.db', env: {}, projectRoot: root, artifactPath,
    }).source).toBe('explicit');
    expect(resolveProjectDatabaseUrl({
      env: { OS_DATABASE_URL: 'file:/env.db' }, projectRoot: root, artifactPath,
    }).source).toBe('env');
  });

  it('falls through to the unified default when the rule names the host-reserved "default"', () => {
    const artifactPath = writeArtifact({
      datasources: [],
      datasourceMapping: [{ default: true, datasource: 'default' }],
    });
    expect(resolveProjectDatabaseUrl({ env: {}, projectRoot: root, artifactPath }).source)
      .toBe('unified-default');
  });

  it('falls through when the named datasource is missing or its URL is underivable', () => {
    // missing declaration
    expect(resolveProjectDatabaseUrl({
      env: {}, projectRoot: root,
      artifactPath: writeArtifact({ datasources: [], datasourceMapping: [{ default: true, datasource: 'ghost' }] }),
    }).source).toBe('unified-default');
    // postgres declared via discrete fields — no DSN is invented for it
    expect(resolveProjectDatabaseUrl({
      env: {}, projectRoot: root,
      artifactPath: writeArtifact({
        datasources: [{ name: 'wh', driver: 'postgres', config: { host: 'h', database: 'd' } }],
        datasourceMapping: [{ default: true, datasource: 'wh' }],
      }),
    }).source).toBe('unified-default');
  });

  it('no mapping rule (the common case — e.g. app-crm) → unified default', () => {
    const artifactPath = writeArtifact({
      datasources: [{ name: 'crm_analytics', driver: 'sqlite', config: { filename: ':memory:' } }],
    });
    expect(resolveProjectDatabaseUrl({ env: {}, projectRoot: root, artifactPath }).source)
      .toBe('unified-default');
  });

  it('missing or http(s) artifacts are skipped', () => {
    expect(resolveProjectDatabaseUrl({
      env: {}, projectRoot: root, artifactPath: join(root, 'nope.json'),
    }).source).toBe('unified-default');
    expect(resolveProjectDatabaseUrl({
      env: {}, projectRoot: root, artifactPath: 'https://example.com/objectstack.json',
    }).source).toBe('unified-default');
  });
});

// The standalone stack (the `os migrate` resolution seam) consumes the shared
// resolver — these pin the two #6469 behaviours visible through it. Cross-
// command agreement lives in the CLI's unified-db-resolution.pin.test.ts.
describe('resolveStandaloneDatabase — #6469 behaviours through the migrate seam', () => {
  const ENV_KEYS = [
    'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL',
    'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('accepts sqlite:// as a file: alias (was: Unsupported database URL scheme)', () => {
    const r = resolveStandaloneDatabase({ databaseUrl: `sqlite://${join(root, 'a.db')}` });
    expect(r.driver).toBe('sqlite');
    expect(r.url).toBe(`file:${join(root, 'a.db')}`);
    expect(r.sqliteFile).toBe(join(root, 'a.db'));
  });

  it('still refuses a genuinely unsupported scheme, message intact', () => {
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'redis://localhost:6379' }))
      .toThrow(/Unsupported database URL scheme/);
  });

  it('resolves the unified default for a projectRoot, and surfaces the legacy notice', () => {
    const fresh = resolveStandaloneDatabase({ projectRoot: root, artifactPath: join(root, 'no-artifact.json') });
    expect(fresh.url).toBe(`file:${unified()}`);
    expect(fresh.source).toBe('unified-default');
    expect(fresh.notice).toBeUndefined();

    seedDataDir('standalone.db');
    const legacy = resolveStandaloneDatabase({ projectRoot: root, artifactPath: join(root, 'no-artifact.json') });
    expect(legacy.url).toBe(`file:${join(dataDir(), 'standalone.db')}`);
    expect(legacy.source).toBe('legacy-file');
    expect(legacy.notice).toContain('standalone.db');
  });
});
