// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #6469 PIN: `os dev`, `os start` and `os migrate` resolve the SAME
 * database URL for the same project root, in EVERY fallback state.
 *
 * This is the test whose absence let the three-way default fork live:
 * `dev-default-db.test.ts` pinned dev's own filename (`dev.db`), nothing
 * pinned start's (`objectstack.db`) or migrate's (`standalone.db`), and no
 * test compared them — so `os migrate plan` could open a fresh empty
 * `standalone.db` of its own making and report every table of a healthy
 * `objectstack.db` deployment as "to create" (the inverted failure
 * direction, issue #6469's measured harm).
 *
 * Each case drives the three commands' REAL resolution seams —
 * `resolveDevDatabase` (dev.ts), `resolveStartDatabase` (start.ts) and
 * `resolveStandaloneDatabase` (@objectstack/runtime, the `os migrate` boot and
 * occupancy-probe seam) — with the inputs those commands pass at runtime. If
 * any command grows its own fallback again, its seam diverges here and this
 * file goes red.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';
import { resolveDevDatabase } from './dev.js';
import { resolveStartDatabase } from './start.js';
import { resolveStandaloneDatabase } from '@objectstack/runtime';

// The seams lazy-import @objectstack/runtime; the first cold import can exceed
// vitest's 5s default — warm it once (standalone-stack.test.ts's BOOT_TIMEOUT).
beforeAll(async () => { await import('@objectstack/runtime'); }, 60_000);

// resolveStandaloneDatabase reads process.env (the other two take env as an
// argument) — scrub the vars that steer resolution so each case controls its
// own inputs, and restore them afterwards.
const ENV_KEYS = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
] as const;
const saved: Record<string, string | undefined> = {};

let root: string;
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  root = mkdtempSync(path.join(tmpdir(), 'os-6469-pin-'));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

const dataDir = () => path.join(root, '.objectstack', 'data');

function seedDataDir(...files: string[]): void {
  mkdirSync(dataDir(), { recursive: true });
  for (const f of files) writeFileSync(path.join(dataDir(), f), '');
}

/**
 * Resolve through all three command seams with the inputs each command passes
 * at runtime for a project rooted at `root`:
 *   - dev:     projectRoot = cwd, env from the process
 *   - start:   homeDir = its resolved project-mode home (<cwd>/.objectstack)
 *   - migrate: resolveStandaloneDatabase({ projectRoot }) — the exact call
 *              `bootSchemaStack`/`probeMigrationTarget` make (plus the artifact
 *              the boot would read, when the case provides one)
 */
async function resolveAllThree(opts: { env?: Record<string, string | undefined>; artifactPath?: string } = {}) {
  const env = opts.env ?? {};
  const dev = await resolveDevDatabase({ env, cwd: root, artifactPath: opts.artifactPath });
  const start = await resolveStartDatabase({
    env,
    homeDir: path.join(root, '.objectstack'),
    projectRoot: root,
    artifactPath: opts.artifactPath,
  });
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const migrate = resolveStandaloneDatabase({
    projectRoot: root,
    ...(opts.artifactPath ? { artifactPath: opts.artifactPath } : { artifactPath: path.join(root, 'dist', 'objectstack.json') }),
  });
  return { dev, start, migrate };
}

function expectAllSame(r: Awaited<ReturnType<typeof resolveAllThree>>, url: string) {
  expect(r.dev.url).toBe(url);
  expect(r.start.url).toBe(url);
  expect(r.migrate.url).toBe(url);
}

describe('#6469 pin — dev / start / migrate resolve ONE URL per project root', () => {
  it('fresh project (nothing on disk): all three → the unified default file', async () => {
    const r = await resolveAllThree();
    expectAllSame(r, `file:${path.join(dataDir(), 'objectstack.db')}`);
    expect(r.dev.source).toBe('unified-default');
    expect(r.start.source).toBe('unified-default');
    expect(r.migrate.source).toBe('unified-default');
  });

  it('unified default present: all three read it, no notice', async () => {
    seedDataDir('objectstack.db');
    const r = await resolveAllThree();
    expectAllSame(r, `file:${path.join(dataDir(), 'objectstack.db')}`);
    expect(r.dev.notice).toBeUndefined();
    expect(r.migrate.notice).toBeUndefined();
  });

  it('legacy dev.db state: all three compat-read the SAME legacy file, loudly', async () => {
    seedDataDir('dev.db');
    const r = await resolveAllThree();
    expectAllSame(r, `file:${path.join(dataDir(), 'dev.db')}`);
    for (const seat of [r.dev, r.start, r.migrate]) {
      expect(seat.source).toBe('legacy-file');
      expect(seat.notice).toContain('dev.db');
    }
  });

  it('legacy standalone.db state: all three compat-read it', async () => {
    seedDataDir('standalone.db');
    const r = await resolveAllThree();
    expectAllSame(r, `file:${path.join(dataDir(), 'standalone.db')}`);
  });

  it('both legacies: all three prefer dev.db (identical probe order — per-command affinity would re-fork)', async () => {
    seedDataDir('dev.db', 'standalone.db');
    const r = await resolveAllThree();
    expectAllSame(r, `file:${path.join(dataDir(), 'dev.db')}`);
  });

  it('config-declared datasource: all three resolve the SAME declared connection', async () => {
    mkdirSync(path.join(root, 'dist'), { recursive: true });
    const artifactPath = path.join(root, 'dist', 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify({
      datasources: [
        { name: 'crm_primary', driver: 'sqlite', config: { filename: '.objectstack/data/crm.db' } },
      ],
      datasourceMapping: [{ default: true, datasource: 'crm_primary' }],
    }));
    const r = await resolveAllThree({ artifactPath });
    expectAllSame(r, `file:${path.join(root, '.objectstack', 'data', 'crm.db')}`);
    expect(r.dev.source).toBe('config-datasource');
    expect(r.start.source).toBe('config-datasource');
    expect(r.migrate.source).toBe('config-datasource');
    expect(r.migrate.datasourceName).toBe('crm_primary');
  });

  it('env URL (sqlite:// alias): all three normalize to the SAME file: URL', async () => {
    const target = path.join(root, 'named.db');
    const r = await resolveAllThree({ env: { OS_DATABASE_URL: `sqlite://${target}` } });
    expectAllSame(r, `file:${target}`);
    expect(r.migrate.driver).toBe('sqlite');
    expect(r.migrate.sqliteFile).toBe(target);
  });
});
