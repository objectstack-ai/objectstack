// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The condition these pin was reproduced end to end against a live
// `objectstack serve` before any of this was written: the data directory was
// deleted under a running server, the process kept three `(deleted)`
// descriptors open, `GET /api/v1/health` kept answering 200 with every seeded
// row, a second boot created a brand-new database at the same path, and an
// edit written into THAT file with its own server stopped had no observable
// effect on the first server — while the user id the first server was
// authenticating did not exist in it. Nothing anywhere said so.
//
// The tests below drive the same two transitions against the real filesystem
// (unlink, and unlink-then-recreate), because the whole question is whether a
// path still names the same file and a mocked `stat` cannot be wrong about
// that in the way a real filesystem can.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stats } from 'node:fs';
import {
  captureServedDatabaseFile,
  checkServedDatabaseFile,
  describeServedDatabaseFileDivergence,
  watchServedDatabaseFile,
  SERVED_DATABASE_FILE_CHECK_INTERVAL_MS,
  type ServedDatabaseFile,
} from './served-database-file.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-served-db-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  dbPath = join(dir, 'data', 'objectstack.db');
  writeFileSync(dbPath, 'first-boot');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A `stat` stub that reports one identity, or throws one errno.
 *
 * `birthtimeMs`/`ctimeMs` default to two different values, which is what arms
 * the second rung — the same thing a real database file does once it has been
 * written to since it was created.
 */
const statStub = (
  result: { dev: number; ino: number; birthtimeMs?: number; ctimeMs?: number } | { code: string },
) =>
  ((): Stats => {
    if ('code' in result) {
      const err = new Error(result.code) as NodeJS.ErrnoException;
      err.code = result.code;
      throw err;
    }
    return { birthtimeMs: 1_000, ctimeMs: 2_000, ...result } as unknown as Stats;
  });

describe('captureServedDatabaseFile', () => {
  it('records the device and inode of the file at the path', () => {
    const captured = captureServedDatabaseFile(dbPath);
    const real = statSync(dbPath);
    expect(captured?.path).toBe(dbPath);
    expect(captured?.dev).toBe(Number(real.dev));
    expect(captured?.ino).toBe(Number(real.ino));
  });

  it('arms the birth-time rung only when this filesystem keeps birth and change times apart', () => {
    // Armed: the two differ, so birth time cannot be a copy of `ctime`.
    expect(captureServedDatabaseFile(dbPath, {
      stat: statStub({ dev: 1, ino: 2, birthtimeMs: 100, ctimeMs: 500 }),
    })).toEqual({ path: dbPath, dev: 1, ino: 2, birthtimeMs: 100 });

    // Disarmed: indistinguishable from the documented `ctime` fallback, under
    // which every write to a healthy database would read as a replacement.
    expect(captureServedDatabaseFile(dbPath, {
      stat: statStub({ dev: 1, ino: 2, birthtimeMs: 500, ctimeMs: 500 }),
    })).toEqual({ path: dbPath, dev: 1, ino: 2, birthtimeMs: undefined });
  });

  it('answers undefined when nothing is at the path', () => {
    expect(captureServedDatabaseFile(join(dir, 'data', 'absent.db'))).toBeUndefined();
  });

  it('answers undefined when the filesystem reports no usable inode', () => {
    // Some Windows volumes report `ino: 0`. A watch seeded from that identity
    // would call every later look a divergence — the one failure it must not
    // have — so there is nothing to watch.
    expect(captureServedDatabaseFile(dbPath, { stat: statStub({ dev: 1, ino: 0 }) })).toBeUndefined();
  });
});

describe('checkServedDatabaseFile — against the real filesystem', () => {
  it('is unchanged while the file is the same file', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    // Writing THROUGH the same inode is not a change of identity — this is
    // what a healthy serving process does all day.
    writeFileSync(dbPath, 'more pages');
    expect(checkServedDatabaseFile(opened)).toEqual({ kind: 'unchanged' });
  });

  it('reports missing after the data directory is deleted under it', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    rmSync(join(dir, 'data'), { recursive: true, force: true });   // `demo:reset`
    expect(checkServedDatabaseFile(opened)).toEqual({ kind: 'missing' });
  });

  it('reports replaced once a later boot puts a different database at the same path', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    // The replacement is created while the original still exists, so the two
    // inodes are necessarily distinct — otherwise this test is at the mercy of
    // inode RECYCLING, which is real: measured here, deleting the file and
    // recreating one at the same path in the same millisecond handed back the
    // same inode. That case is covered on the birth-time rung below.
    const incoming = join(dir, 'data', 'incoming.db');
    writeFileSync(incoming, 'second boot');
    rmSync(dbPath);
    renameSync(incoming, dbPath);

    const verdict = checkServedDatabaseFile(opened);
    expect(verdict).toEqual({
      kind: 'replaced',
      onDisk: { dev: Number(statSync(dbPath).dev), ino: Number(statSync(dbPath).ino) },
      inodeReused: false,
    });
    expect(Number(statSync(dbPath).ino)).not.toBe(opened.ino);
  });
});

describe('checkServedDatabaseFile — a read that failed is never a divergence', () => {
  const opened: ServedDatabaseFile = { path: '/some/objectstack.db', dev: 10, ino: 20 };

  it('reports unreadable, not missing, when the path cannot be read', () => {
    const verdict = checkServedDatabaseFile(opened, { stat: statStub({ code: 'EACCES' }) });
    expect(verdict).toEqual({ kind: 'unreadable', reason: 'EACCES' });
    expect(describeServedDatabaseFileDivergence(opened, verdict)).toBeUndefined();
  });

  it('reports unreadable when the later look has no usable inode either', () => {
    const verdict = checkServedDatabaseFile(opened, { stat: statStub({ dev: 10, ino: 0 }) });
    expect(verdict.kind).toBe('unreadable');
    expect(describeServedDatabaseFileDivergence(opened, verdict)).toBeUndefined();
  });

  it('treats a device change as a divergence even at the same inode number', () => {
    // Inode numbers are only unique per filesystem, so a remount or a bind
    // mount can hand back the same number for a different file.
    const verdict = checkServedDatabaseFile(opened, { stat: statStub({ dev: 11, ino: 20 }) });
    expect(verdict).toEqual({ kind: 'replaced', onDisk: { dev: 11, ino: 20 }, inodeReused: false });
  });
});

describe('checkServedDatabaseFile — the recycled inode', () => {
  // The case a dev+inode comparison alone cannot see, and the one the card's
  // own second half describes: the data directory is deleted and a later boot
  // creates a brand-new database at the same path, onto the freed inode.
  const armed: ServedDatabaseFile = { path: '/app/objectstack.db', dev: 10, ino: 20, birthtimeMs: 1_000 };

  it('reports replaced when the same inode carries a newer birth time', () => {
    const verdict = checkServedDatabaseFile(armed, {
      stat: statStub({ dev: 10, ino: 20, birthtimeMs: 9_000, ctimeMs: 9_500 }),
    });
    expect(verdict).toEqual({ kind: 'replaced', onDisk: { dev: 10, ino: 20 }, inodeReused: true });
    expect(describeServedDatabaseFileDivergence(armed, verdict)).toContain('recycled inode 20');
  });

  it('stays silent for an ordinary write, which moves change time and not birth time', () => {
    expect(checkServedDatabaseFile(armed, {
      stat: statStub({ dev: 10, ino: 20, birthtimeMs: 1_000, ctimeMs: 8_000 }),
    })).toEqual({ kind: 'unchanged' });
  });

  it('cannot report on the second rung when it was never armed', () => {
    // No `birthtimeMs` on the captured identity — a filesystem whose birth
    // time is a copy of `ctime`, where trusting it would call every write a
    // replacement. One rung is the conservative answer, never a wrong one.
    const disarmed: ServedDatabaseFile = { path: '/app/objectstack.db', dev: 10, ino: 20 };
    expect(checkServedDatabaseFile(disarmed, {
      stat: statStub({ dev: 10, ino: 20, birthtimeMs: 9_000, ctimeMs: 9_000 }),
    })).toEqual({ kind: 'unchanged' });
  });
});

describe('describeServedDatabaseFileDivergence', () => {
  const opened: ServedDatabaseFile = { path: '/app/.objectstack/data/objectstack.db', dev: 10, ino: 20 };

  it('says nothing when there is nothing to say', () => {
    expect(describeServedDatabaseFileDivergence(opened, { kind: 'unchanged' })).toBeUndefined();
  });

  it('owes a consequence and a fix, and pays both', () => {
    const message = describeServedDatabaseFileDivergence(opened, { kind: 'missing' })!;
    expect(message).toContain(opened.path);
    // (1) the consequence, concretely — including that it keeps looking healthy
    expect(message).toContain('no observable effect');
    expect(message).toContain('keeps answering 200');
    // (2) the fix
    expect(message).toContain('restart this server');
    expect(message).toContain('rm -rf .objectstack/data');
  });

  it('names both identities when the file was replaced', () => {
    const message = describeServedDatabaseFileDivergence(opened, {
      kind: 'replaced',
      onDisk: { dev: 10, ino: 77 },
      inodeReused: false,
    })!;
    expect(message).toContain('10/20');
    expect(message).toContain('10/77');
  });
});

describe('watchServedDatabaseFile', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays silent while the file is unchanged', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    const onDiverged = vi.fn();
    const watch = watchServedDatabaseFile({ opened, onDiverged, intervalMs: 1_000 })!;
    vi.advanceTimersByTime(10_000);
    expect(onDiverged).not.toHaveBeenCalled();
    watch.stop();
  });

  it('reports ONCE and stops watching', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    const onDiverged = vi.fn();
    watchServedDatabaseFile({ opened, onDiverged, intervalMs: 1_000 });

    rmSync(join(dir, 'data'), { recursive: true, force: true });
    vi.advanceTimersByTime(1_000);
    expect(onDiverged).toHaveBeenCalledTimes(1);
    expect(onDiverged.mock.calls[0][0]).toContain(dbPath);
    expect(onDiverged.mock.calls[0][1]).toEqual({ kind: 'missing' });

    // The condition is permanent until a restart; repeating it every interval
    // would make it unreadable, which is what made the founding incident's
    // warning unreadable in the first place.
    vi.advanceTimersByTime(60_000);
    expect(onDiverged).toHaveBeenCalledTimes(1);
  });

  it('has nothing to run on a non-positive interval', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    expect(watchServedDatabaseFile({ opened, onDiverged: vi.fn(), intervalMs: 0 })).toBeUndefined();
  });

  it('stop() is idempotent and silences the watch', () => {
    const opened = captureServedDatabaseFile(dbPath)!;
    const onDiverged = vi.fn();
    const watch = watchServedDatabaseFile({ opened, onDiverged })!;
    watch.stop();
    watch.stop();
    rmSync(join(dir, 'data'), { recursive: true, force: true });
    vi.advanceTimersByTime(SERVED_DATABASE_FILE_CHECK_INTERVAL_MS * 3);
    expect(onDiverged).not.toHaveBeenCalled();
  });
});
