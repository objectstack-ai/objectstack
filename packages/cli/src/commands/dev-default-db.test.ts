// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack dev` database resolution — the dev seam of the ONE shared
 * resolution (#6469).
 *
 * This file used to pin `dev`'s OWN default (`.objectstack/data/dev.db`) —
 * which is exactly how the three-way default fork lived: each command's test
 * pinned its own filename and nothing asserted they agree. The maintainer
 * ruling (#6469, 2026-08-08) unified the default on `objectstack.db`, so this
 * file now pins the dev seam's mapping onto `resolveProjectDatabaseUrl`;
 * cross-command agreement is pinned by `unified-db-resolution.pin.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';
import { resolveDevDatabase } from './dev.js';

// The dev seam lazy-imports @objectstack/runtime (oclif startup weight, #5726);
// the FIRST import cold-loads that graph and can exceed vitest's 5s default on
// a cold worker — warm it once, like standalone-stack.test.ts's BOOT_TIMEOUT.
beforeAll(async () => { await import('@objectstack/runtime'); }, 60_000);

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(path.join(tmpdir(), 'os-dev-db-')); });
afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* noop */ } });

const unified = () => `file:${path.join(cwd, '.objectstack', 'data', 'objectstack.db')}`;

describe('resolveDevDatabase — objectstack dev persists by default (#6469 unified)', () => {
  it('defaults to the unified project-anchored sqlite file when nothing else is chosen', async () => {
    const r = await resolveDevDatabase({ env: {}, cwd });
    expect(r).toEqual({ url: unified(), source: 'unified-default' });
  });

  it('yields to an explicit --database flag (normalized: sqlite:// → file:)', async () => {
    expect(await resolveDevDatabase({ databaseFlag: 'postgres://x', env: {}, cwd }))
      .toEqual({ url: 'postgres://x', source: 'explicit' });
    expect(await resolveDevDatabase({ databaseFlag: 'sqlite:///abs/flag.db', env: {}, cwd }))
      .toEqual({ url: 'file:/abs/flag.db', source: 'explicit' });
  });

  it('yields to --fresh (its own ephemeral temp DB, unified filename)', async () => {
    const r = await resolveDevDatabase({ freshDbUrl: 'file:/tmp/x/objectstack.db', env: {}, cwd });
    expect(r).toEqual({ url: 'file:/tmp/x/objectstack.db', source: 'explicit' });
  });

  it('yields to OS_DATABASE_URL / DATABASE_URL / TURSO_DATABASE_URL env', async () => {
    expect(await resolveDevDatabase({ env: { OS_DATABASE_URL: 'file:./custom.db' }, cwd }))
      .toEqual({ url: 'file:./custom.db', source: 'env' });
    expect(await resolveDevDatabase({ env: { DATABASE_URL: 'libsql://x' }, cwd }))
      .toEqual({ url: 'libsql://x', source: 'env' });
    expect(await resolveDevDatabase({ env: { TURSO_DATABASE_URL: 'libsql://t' }, cwd }))
      .toEqual({ url: 'libsql://t', source: 'env' });
  });

  it('respects an explicit in-memory driver opt-out (no file default imposed)', async () => {
    expect(await resolveDevDatabase({ databaseDriverFlag: 'memory', env: {}, cwd }))
      .toEqual({ url: 'memory://', source: 'memory-driver' });
    expect(await resolveDevDatabase({ env: { OS_DATABASE_DRIVER: 'memory' }, cwd }))
      .toEqual({ url: 'memory://', source: 'memory-driver' });
  });

  it('treats blank env values as unset (still defaults to the unified file)', async () => {
    expect((await resolveDevDatabase({ env: { OS_DATABASE_URL: '  ' }, cwd })).url).toBe(unified());
  });

  it('compat-reads a legacy dev.db with one loud notice — never silent, never a prompt', async () => {
    const dataDir = path.join(cwd, '.objectstack', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, 'dev.db'), '');
    const r = await resolveDevDatabase({ env: {}, cwd });
    expect(r.url).toBe(`file:${path.join(dataDir, 'dev.db')}`);
    expect(r.source).toBe('legacy-file');
    expect(r.notice).toContain('dev.db');
    expect(r.notice).toContain('objectstack.db');
  });

  it('honours OS_HOME for the state dir (start/migrate already did; dev now agrees)', async () => {
    const osHome = path.join(cwd, 'oshome');
    const r = await resolveDevDatabase({ env: { OS_HOME: osHome }, cwd });
    expect(r.url).toBe(`file:${path.join(osHome, 'data', 'objectstack.db')}`);
  });
});
