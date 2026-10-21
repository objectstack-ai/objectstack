// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { accessSync, constants, lstatSync, statSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * A SQLite database file this driver cannot open or create (#23696), or one
 * whose bytes are not a SQLite database (#24960).
 *
 * Thrown by `SqlDriver.connect()`, so the boot's connect refusal (ADR-0062 D5,
 * `datasource '<name>': connect failed — <reason>`) carries the path and the
 * operating system's own answer instead of waiting for a plugin start timeout.
 * `code` is the underlying error's (`ENOENT`, `EACCES`, `ENOTDIR`,
 * `SQLITE_CANTOPEN`, `SQLITE_NOTADB`, …) and `cause` the error itself.
 */
export class SqliteDatabaseFileError extends Error {
  readonly code: string | undefined;
  readonly filename: string;
  /** The error the operating system or SQLite answered. */
  readonly cause: unknown;

  constructor(filename: string, detail: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const code = (cause as { code?: unknown } | null | undefined)?.code;
    const where = isAbsolute(filename) ? `'${filename}'` : `'${filename}' (resolved: '${resolve(filename)}')`;
    super(`SQLite database file ${where} ${detail}: ${reason}`);
    this.name = 'SqliteDatabaseFileError';
    this.code = typeof code === 'string' ? code : undefined;
    this.filename = filename;
    this.cause = cause;
  }
}

/**
 * Make `dir` exist, creating each missing level with a NON-recursive `mkdir`,
 * and reject at once with the first level the operating system refuses.
 *
 * ## Why not `mkdir(dir, { recursive: true })`
 *
 * Node's recursive mkdir (v22.22.0, measured; sync and async alike) never
 * settles when a level answers `ENOENT` although its parent exists. On
 * `/proc/os-23696` it loops `mkdir("/proc/os-23696") = ENOENT`,
 * `mkdir("/proc") = EEXIST`, `statx("/proc")` (a directory, so retry the
 * child) without end — about 1,640 failing `mkdir` calls a second, all of
 * it system CPU. A declared SQLite datasource whose directory lay on such a
 * path never finished its connect, and the boot was refused only by a plugin
 * start timeout that named neither the datasource nor the path.
 *
 * The walk below is bounded by the path's depth: find the nearest level that
 * exists, then create the missing ones top-down. `EEXIST` on a level is a
 * concurrent creator winning the race and is accepted; any other refusal is
 * the answer. When a file holds the nearest existing name, the operating
 * system answers for it too: `ENOTDIR` from the first missing level under it,
 * or `EEXIST` from asking for `dir` itself.
 */
export async function makeDatabaseDirectory(dir: string): Promise<void> {
  const missing: string[] = [];
  let level = resolve(dir);
  for (;;) {
    try {
      if (!(await stat(level)).isDirectory() && missing.length === 0) await mkdir(level);
      break;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== 'ENOENT') throw e;
      missing.push(level);
      const parent = dirname(level);
      if (parent === level) break;
      level = parent;
    }
  }
  for (const each of missing.reverse()) {
    try {
      await mkdir(each);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== 'EEXIST') throw e;
    }
  }
}

/**
 * Does the SQLite database file `filename` exist, or is it absent in a way a
 * boot that may write could bring into existence? Answered WITHOUT writing
 * anything, and thrown as a {@link SqliteDatabaseFileError} when it is neither
 * (#24961) — so under `sqliteAbsentFile: 'empty-in-memory'` that error comes
 * from `resolveSqliteAbsentFileTarget`, and from the `SqlDriver` constructor,
 * before any `connect()`.
 *
 * The read-only twin of {@link makeDatabaseDirectory}, for
 * `sqliteAbsentFile: 'empty-in-memory'`, whose contract is that the filesystem
 * is left untouched — so neither the directory nor the file may be created to
 * find out. The same walk, with the question the operating system answers
 * without a write in place of each `mkdir`:
 *
 *   - `stat(filename)` succeeds: `'exists'`.
 *   - `stat(filename)` answers anything but `ENOENT` — `ENOTDIR` (a regular
 *     file holds a level of the path), `EACCES` (a level this process may not
 *     search), `ELOOP`, `ENAMETOOLONG` — the file cannot exist, and that answer
 *     is the refusal. `existsSync` answers `false` for every one of these, which
 *     is how a read-only boot used to open an empty in-memory database over a
 *     path its writing twin refuses, and report the datasource connected.
 *   - `ENOENT`: walk up to the nearest level that exists. A level whose name a
 *     dangling symbolic link holds cannot be made (`mkdir` answers `EEXIST`,
 *     and nothing can be created through it): refused. Otherwise the level is a
 *     directory — a non-directory would have answered `ENOTDIR` above — and
 *     creating the next level, or the file, needs write and search permission
 *     on it: `access(W_OK | X_OK)`, whose refusal (`EACCES`; `EROFS` on a
 *     read-only mount) is the answer. Otherwise `'absent'`.
 *
 * What it cannot tell without a write: a directory whose `access` succeeds but
 * whose `mkdir` fails anyway. `/proc/<missing>/` as root answers `access` with
 * success and `mkdir` with `ENOENT`, so such a path still reads `'absent'` here;
 * `SqlDriver.connect()` refuses it on a boot that may write.
 */
export function probeAbsentSqliteDatabaseFile(filename: string): 'exists' | 'absent' {
  try {
    statSync(filename);
    return 'exists';
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') throw new SqliteDatabaseFileError(filename, 'cannot be opened or created', e);
  }
  const dir = dirname(resolve(filename));
  const unmakeable = `cannot be created: its directory '${dirname(filename)}' cannot be made`;
  let level = dir;
  for (;;) {
    try {
      statSync(level);
      break;
    } catch (e) {
      if (errorCode(e) !== 'ENOENT') throw new SqliteDatabaseFileError(filename, unmakeable, e);
      if (isDanglingLink(level)) {
        throw new SqliteDatabaseFileError(filename, `${unmakeable} ('${level}' is a symbolic link to a path that does not exist)`, e);
      }
      const parent = dirname(level);
      if (parent === level) break;
      level = parent;
    }
  }
  try {
    accessSync(level, constants.W_OK | constants.X_OK);
  } catch (e) {
    throw new SqliteDatabaseFileError(filename, level === dir ? 'cannot be opened or created' : unmakeable, e);
  }
  return 'absent';
}

/** A name `stat` answered `ENOENT` for, that `lstat` still finds: a dangling link. */
function isDanglingLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function errorCode(e: unknown): unknown {
  return (e as { code?: unknown } | null | undefined)?.code;
}
