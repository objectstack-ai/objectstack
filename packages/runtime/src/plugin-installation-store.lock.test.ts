// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] The installations file's lock, and the record changes that
 * run under it: the uninstall mark, the boot's drop, and the disable kept for
 * an installed plugin.
 *
 * Pinned: a writer waits for a live holder and then refuses, naming it and the
 * lock file; a stale lock (dead pid, too old, an unparseable leftover, this
 * thread's own pid and thread while it holds nothing) is cleared by the next
 * writer, and another thread of this process holding it is live; a lock judged
 * stale and replaced by a live writer before it is cleared is left alone (the
 * two-writer steal race), and a steal lock a crashed writer left is cleared
 * while a live writer's is kept up to the stale bound, and waited for without
 * spinning; a lock path that is there and is not a lock file (a directory, a
 * dangling symbolic link) or cannot be read is refused by name at once, never
 * retried; a lock gone each time it is read is waited out and refused at the
 * deadline, with a pause between tries;
 * the lock is re-entrant and always released, and a release never removes a
 * lock that is no longer the holder's; two processes writing at once both land
 * every record; and another project's records keep their directories out of
 * an uninstall.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { threadId } from 'node:worker_threads';

import {
  INSTALLATIONS_LOCK_STALE_MS,
  PluginInstallationsLockedError,
  installationsLockTestHooks,
  dropPluginInstallation,
  installedPluginDisabledIds,
  loadPluginInstallations,
  markPluginUninstall,
  otherProjectsInstallationDirs,
  pluginInstallDir,
  pluginInstallationsFile,
  recordPluginInstallation,
  setInstalledPluginDisabled,
  withPluginInstallationsLock,
  type PluginInstallationRecord,
} from './plugin-installation-store.js';
import { loadDisabledPackageIds, packageStateFileName } from './package-state-store.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A file read or `lstat` the test makes throw, by its path; every other call is the real one. */
const fsFaults = vi.hoisted(() => ({
  failRead: null as ((path: string) => string | null) | null,
  failLstat: null as ((path: string) => string | null) | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      const code = fsFaults.failRead?.(String(args[0]));
      if (code) throw Object.assign(new Error(`${code}: read refused by the test, '${String(args[0])}'`), { code });
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    lstatSync: ((...args: Parameters<typeof actual.lstatSync>) => {
      const code = fsFaults.failLstat?.(String(args[0]));
      if (code) throw Object.assign(new Error(`${code}: lstat refused by the test, '${String(args[0])}'`), { code });
      return actual.lstatSync(...args);
    }) as typeof actual.lstatSync,
  };
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let home: string;
const saved = { OS_HOME: process.env.OS_HOME };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'os-plugin-installs-lock-'));
  process.env.OS_HOME = home;
});

afterEach(() => {
  fsFaults.failRead = null;
  fsFaults.failLstat = null;
  installationsLockTestHooks.afterStaleJudged = undefined;
  if (saved.OS_HOME === undefined) delete process.env.OS_HOME;
  else process.env.OS_HOME = saved.OS_HOME;
  rmSync(home, { recursive: true, force: true });
});

function record(id: string, version = '1.0.0'): PluginInstallationRecord {
  return {
    id,
    version,
    versionId: `${id}@${version}`,
    runtime: 'node',
    status: 'installed',
    grantedPermissions: null,
    dir: pluginInstallDir('env_local', id, version),
    artifact: { file: 'artifact.osplugin', sha256: '0'.repeat(64) },
    signatureFile: null,
    signature: null,
    trustUnsigned: true,
    installedAt: '2026-10-29T00:00:00.000Z',
  };
}

function lockFile(): string {
  const file = pluginInstallationsFile('env_local');
  mkdirSync(dirname(file), { recursive: true });
  return `${file}.lock`;
}

/** A pid that was a process a moment ago and is not one now. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid as number;
}

describe('the installations lock', () => {
  it('waits for a live holder, then refuses naming the holder and the lock file', () => {
    const lock = lockFile();
    // The parent of this worker: alive for the whole test.
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: '2026-10-29T00:00:00.000Z' }));
    const t0 = Date.now();
    expect(() => withPluginInstallationsLock('env_local', () => 'never', { waitMs: 300 }))
      .toThrow(new RegExp(`locked by process ${process.ppid} .*remove ${escapeRe(lock)}`));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    // The holder's lock is left alone.
    expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.ppid);
  });

  it.each([
    ['a dead pid', () => JSON.stringify({ pid: deadPid(), at: 'then' }), 0],
    ['this thread\'s own pid and thread while it holds nothing', () => JSON.stringify({ pid: process.pid, thread: threadId, at: 'then' }), 0],
    ['a live pid older than the stale bound', () => JSON.stringify({ pid: process.ppid, at: 'then' }), INSTALLATIONS_LOCK_STALE_MS + 60_000],
    ['an unparseable leftover older than a second', () => '{"pid":', 5_000],
  ])('clears a stale lock: %s', (_label, body, ageMs) => {
    const lock = lockFile();
    writeFileSync(lock, body());
    if (ageMs > 0) {
      const then = new Date(Date.now() - ageMs);
      utimesSync(lock, then, then);
    }
    expect(withPluginInstallationsLock('env_local', () => 'ran', { waitMs: 300 })).toBe('ran');
    expect(existsSync(lock)).toBe(false);
  });

  it('does not clear an unparseable lock a writer has only just created', () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    expect(() => withPluginInstallationsLock('env_local', () => 'never', { waitMs: 200 }))
      .toThrow(/a writer that has not yet written its pid/);
    expect(existsSync(lock)).toBe(true);
  });

  it('treats a lock another thread of this process holds as live', () => {
    const lock = lockFile();
    writeFileSync(lock, JSON.stringify({ pid: process.pid, thread: threadId + 1, at: '2026-10-29T00:00:00.000Z' }));
    expect(() => withPluginInstallationsLock('env_local', () => 'never', { waitMs: 200 }))
      .toThrow(new RegExp(`locked by process ${process.pid} thread ${threadId + 1} `));
    expect(existsSync(lock)).toBe(true);
  });

  it('refuses with a PluginInstallationsLockedError, so a caller can name it apart from other failures', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, at: 'now' }));
    let thrown: unknown;
    try {
      withPluginInstallationsLock('env_local', () => 'never', { waitMs: 100 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PluginInstallationsLockedError);
    expect((thrown as Error).name).toBe('PluginInstallationsLockedError');
  });

  it('leaves a stale lock alone once a live writer has replaced it since the judgement (the steal race)', () => {
    // Writer B judges a dead holder's lock stale. Before B clears it, writer A
    // (the hook) clears the same stale lock and takes a fresh one. B must not
    // remove A's lock: it waits for A instead, and refuses naming A.
    const lock = lockFile();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: 'then' }));
    const writerA = JSON.stringify({ pid: process.ppid, token: 'writer-a', at: '2026-10-29T00:00:00.000Z' });
    let ranB = false;
    installationsLockTestHooks.afterStaleJudged = (path) => {
      installationsLockTestHooks.afterStaleJudged = undefined;
      rmSync(path);
      writeFileSync(path, writerA, { flag: 'wx' });
    };
    try {
      expect(() => withPluginInstallationsLock('env_local', () => { ranB = true; }, { waitMs: 300 }))
        .toThrow(new RegExp(`locked by process ${process.ppid} `));
    } finally {
      installationsLockTestHooks.afterStaleJudged = undefined;
    }
    expect(ranB).toBe(false);
    expect(readFileSync(lock, 'utf8')).toBe(writerA);
    expect(existsSync(`${lock}.steal`)).toBe(false);
  });

  it('clears a steal lock a writer left when it died clearing a stale lock, judged by its pid', () => {
    const lock = lockFile();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: 'then' }));
    // Fresh, so only its dead pid makes it stale.
    writeFileSync(`${lock}.steal`, JSON.stringify({ pid: deadPid(), at: 'now' }));
    expect(withPluginInstallationsLock('env_local', () => 'ran', { waitMs: 1_000 })).toBe('ran');
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(`${lock}.steal`)).toBe(false);
  });

  it('keeps a steal lock a live writer holds, inside the stale bound, and waits for it without spinning', () => {
    const lock = lockFile();
    const stale = JSON.stringify({ pid: deadPid(), at: 'then' });
    const clearing = JSON.stringify({ pid: process.ppid, token: 'slow-writer', at: 'then' });
    writeFileSync(lock, stale);
    writeFileSync(`${lock}.steal`, clearing);
    // A minute old, well inside the stale bound: a live writer's steal lock
    // is not stale by its age until it passes that bound.
    const then = new Date(Date.now() - 60_000);
    utimesSync(`${lock}.steal`, then, then);
    let judged = 0;
    installationsLockTestHooks.afterStaleJudged = () => { judged += 1; };
    const t0 = Date.now();
    expect(() => withPluginInstallationsLock('env_local', () => 'never', { waitMs: 300 }))
      .toThrow(new RegExp(`stale lock .*another writer was still clearing after 0\\.3s.*remove ${escapeRe(lock)} and ${escapeRe(lock)}\\.steal`));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    // A sleep between judgements, not a spin: about one per 50 ms.
    expect(judged).toBeLessThan(20);
    expect(readFileSync(lock, 'utf8')).toBe(stale);
    expect(readFileSync(`${lock}.steal`, 'utf8')).toBe(clearing);
  });

  it('clears a steal lock a live pid holds once it is older than the stale bound', () => {
    const lock = lockFile();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), at: 'then' }));
    // The pid is live, so only the age makes it stale: a pid the operating
    // system reused after the writer that took it died.
    writeFileSync(`${lock}.steal`, JSON.stringify({ pid: process.ppid, token: 'reused-pid', at: 'then' }));
    const then = new Date(Date.now() - INSTALLATIONS_LOCK_STALE_MS - 60_000);
    utimesSync(`${lock}.steal`, then, then);
    expect(withPluginInstallationsLock('env_local', () => 'ran', { waitMs: 1_000 })).toBe('ran');
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(`${lock}.steal`)).toBe(false);
  });

  it.each([
    ['a directory', (lock: string) => mkdirSync(lock), 'it is a directory', 'directory'],
    // The exclusive create fails on the link (EEXIST) and a followed read
    // finds nothing (ENOENT), so taken for "released" it was retried forever.
    ['a dangling symbolic link', (lock: string) => symlinkSync(join(dirname(lock), 'nowhere'), lock), 'it is a symbolic link', 'link'],
    ['a file this user may not read', (lock: string) => {
      writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: 'now' }));
      fsFaults.failRead = (path) => (path === lock ? 'EACCES' : null);
    }, 'EACCES', 'file'],
  ] as const)('refuses a lock path that is there and cannot be read, naming it, at once and without retrying: %s', (_label, plant, why, kind) => {
    const lock = lockFile();
    plant(lock);
    let ran = false;
    const t0 = Date.now();
    expect(() => withPluginInstallationsLock('env_local', () => { ran = true; }, { waitMs: 5_000 }))
      .toThrow(new RegExp(`installations lock ${escapeRe(lock)} cannot be read \\(${why}.*remove it`));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(ran).toBe(false);
    fsFaults.failRead = null;
    const left = lstatSync(lock);
    expect({ directory: left.isDirectory(), link: left.isSymbolicLink(), file: left.isFile() }[kind]).toBe(true);
  });

  it('waits out, with a pause between tries, a lock that is there to create and gone each time it is read, then refuses naming it', () => {
    const lock = lockFile();
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: 'now' }));
    let reads = 0;
    fsFaults.failLstat = (path) => {
      if (path !== lock) return null;
      reads += 1;
      return 'ENOENT';
    };
    let ran = false;
    const t0 = Date.now();
    expect(() => withPluginInstallationsLock('env_local', () => { ran = true; }, { waitMs: 300 }))
      .toThrow(new RegExp(`could not be locked in 0\\.3s: ${escapeRe(lock)} was there .*remove ${escapeRe(lock)}\\.$`));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    // About one read per 50 ms pause; a spin makes thousands.
    expect(reads).toBeLessThan(20);
    expect(ran).toBe(false);
    fsFaults.failLstat = null;
    expect(existsSync(lock)).toBe(true);
  });

  it('never removes, on release, a lock that is no longer the holder\'s', () => {
    const lock = lockFile();
    const other = JSON.stringify({ pid: process.ppid, token: 'other', at: 'now' });
    withPluginInstallationsLock('env_local', () => {
      // Another writer took the lock over (as one would a lock aged past the
      // stale bound) while this one still ran.
      rmSync(lock);
      writeFileSync(lock, other);
    });
    expect(readFileSync(lock, 'utf8')).toBe(other);
  });

  it('is re-entrant within a process, and released when the outer holder returns or throws', () => {
    const lock = `${pluginInstallationsFile('env_local')}.lock`;
    const inner = withPluginInstallationsLock('env_local', () => {
      expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.pid);
      recordPluginInstallation('env_local', record('com.acme.a'));
      return withPluginInstallationsLock('env_local', () => 'inner');
    });
    expect(inner).toBe('inner');
    expect(existsSync(lock)).toBe(false);
    expect(() => withPluginInstallationsLock('env_local', () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
    expect(loadPluginInstallations('env_local').map((r) => r.id)).toEqual(['com.acme.a']);
  });

  it('two processes writing at once both land every record', async () => {
    const subject = pathToFileURL(resolve(HERE, 'plugin-installation-store.ts')).href;
    // Both children import first, then meet at a barrier, so the writes
    // overlap rather than one child finishing before the other has started.
    const script = [
      'const [subject, home, tag] = process.argv.slice(1);',
      'process.env.OS_HOME = home;',
      'const store = await import(subject);',
      'const fs = await import("node:fs");',
      'fs.writeFileSync(home + "/ready-" + tag, "");',
      'const until = Date.now() + 60000;',
      'while (!(fs.existsSync(home + "/ready-a") && fs.existsSync(home + "/ready-b")) && Date.now() < until) {}',
      'for (let i = 0; i < 40; i++) {',
      '  const id = `com.acme.${tag}${i}`;',
      '  store.recordPluginInstallation("env_local", { id, version: "1.0.0", versionId: id + "@1.0.0", runtime: "node",',
      '    status: "installed", grantedPermissions: null, dir: store.pluginInstallDir("env_local", id, "1.0.0"),',
      '    artifact: { file: "artifact.osplugin", sha256: "0".repeat(64) }, signatureFile: null, signature: null,',
      '    trustUnsigned: true, installedAt: new Date().toISOString() });',
      '}',
    ].join('\n');
    const run = (tag: string) =>
      new Promise<{ code: number | null; stderr: string }>((done) => {
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, subject, home, tag], {
          cwd: process.cwd(),
          env: { PATH: process.env.PATH ?? '', HOME: home, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += String(d); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
        child.on('exit', (code) => { clearTimeout(timer); done({ code, stderr }); });
      });
    const [a, b] = await Promise.all([run('a'), run('b')]);
    expect(a.code, a.stderr).toBe(0);
    expect(b.code, b.stderr).toBe(0);
    const ids = loadPluginInstallations('env_local').map((r) => r.id).sort();
    expect(ids).toHaveLength(80);
    expect(new Set(ids).size).toBe(80);
    expect(existsSync(`${pluginInstallationsFile('env_local')}.lock`)).toBe(false);
  }, 120_000);
});

describe('the uninstall mark, the drop, and the disable', () => {
  it('marks an installation uninstall-pending, and answers undefined for an id with none', () => {
    recordPluginInstallation('env_local', record('com.acme.a'));
    recordPluginInstallation('env_local', record('com.acme.b'));
    expect(markPluginUninstall('env_local', 'com.acme.none')).toBeUndefined();
    expect(markPluginUninstall('env_local', 'com.acme.a')?.status).toBe('uninstall-pending');
    expect(loadPluginInstallations('env_local').map((r) => [r.id, r.status])).toEqual([
      ['com.acme.a', 'uninstall-pending'],
      ['com.acme.b', 'installed'],
    ]);
    // A later install of the id replaces the mark.
    recordPluginInstallation('env_local', record('com.acme.a', '1.1.0'));
    expect(loadPluginInstallations('env_local')[0]).toMatchObject({ version: '1.1.0', status: 'installed' });
  });

  it('keeps the disable under the plugin environment id, and the drop forgets it', () => {
    recordPluginInstallation(undefined, record('com.acme.a'));
    setInstalledPluginDisabled(undefined, 'com.acme.a', true);
    expect(installedPluginDisabledIds(undefined).has('com.acme.a')).toBe(true);
    // `env_local` when unset — the plugin store's default, not the package store's `default`.
    expect(existsSync(join(home, 'package-state', packageStateFileName('env_local', process.cwd())))).toBe(true);
    expect(loadDisabledPackageIds('env_local').has('com.acme.a')).toBe(true);
    dropPluginInstallation(undefined, 'com.acme.a');
    expect(loadPluginInstallations(undefined)).toEqual([]);
    expect(installedPluginDisabledIds(undefined).has('com.acme.a')).toBe(false);
  });

  it('names the directories another project in this environment still records, and only those', () => {
    const own = pluginInstallationsFile('env_local');
    recordPluginInstallation('env_local', record('com.acme.a'));
    const dir = dirname(own);
    const other = join(dir, packageStateFileName('env_local', join(home, 'other-project')));
    writeFileSync(other, JSON.stringify({ installations: [record('com.acme.shared')] }));
    // Another environment's file is not this environment's sharing.
    writeFileSync(
      join(dir, packageStateFileName('env_staging', join(home, 'other-project'))),
      JSON.stringify({ installations: [record('com.acme.staging')] }),
    );
    writeFileSync(`${own}.lock.leftover.tmp`, 'ignored');
    expect([...(otherProjectsInstallationDirs('env_local') ?? [])]).toEqual([pluginInstallDir('env_local', 'com.acme.shared', '1.0.0')]);
    // A file it cannot read keeps every directory.
    writeFileSync(other, '{ not json');
    expect(otherProjectsInstallationDirs('env_local')).toBeNull();
  });
});
